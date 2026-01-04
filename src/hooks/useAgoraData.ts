// Filepath: src/hooks/useAgoraData.ts
// Author: Robert Kirkpatrick
// Updated by: ChatGPT
// Version: v1.9.2
// Purpose:
// - Load Agora events from Nostr relays safely (tolerant parsing)
// - Robust OUTBOX for event creation + comments (never blocks user)
// - Optimistic UI: queued items appear immediately and persist across reloads
// - Backoff + throttling prevents spam signer calls (Alby / nos2x)
// - Refresh support (button + pull/gesture can call refresh())
// - Comments: optimistic counter + queued publishing

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as nostr from "../utils/nostr";

/* ----------------------------------------
   Constants
---------------------------------------- */

const FALLBACK_RELAYS: string[] = [
  "wss://relay.damus.io",
  "wss://relay.snort.social",
  "wss://nos.lol",
];

const OUTBOX_KEY = "agora_outbox_v1";

/* ----------------------------------------
   Types
---------------------------------------- */

type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
};

export type AgoraEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  title: string;
  description: string;
  start?: number;
  end?: number;
  location?: string;
  url?: string;
  image_url?: string;

  raw: NostrEvent;

  local?: {
    queued?: boolean;
    publishing?: boolean;
    published?: boolean;
    error?: string;
  };
};

export type NostrProfile = {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
};

type OutboxStatus = "queued" | "publishing" | "published" | "failed";

type OutboxEventItem = {
  id: string;
  created_at: number;
  type: "agora_event";
  payload: {
    name: string;
    startTimestamp: number;
    location: string;
    description?: string;
    image_url?: string;
    landingPageUrl?: string;
  };
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  publishedEventId?: string;
};

type OutboxCommentItem = {
  id: string;
  created_at: number;
  type: "comment";
  payload: {
    eventId: string;
    eventPubkey?: string;
    content: string;
  };
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  publishedEventId?: string; // nostr id of comment (kind 1)
};

type OutboxItem = OutboxEventItem | OutboxCommentItem;

export type UseAgoraDataResult = {
  events: AgoraEvent[];

  hostProfiles: Record<string, NostrProfile>;
  comments: Record<string, any[]>;

  isLoading: boolean;
  isLoadingMore: boolean;
  hasMoreEvents: boolean;
  error: string | null;

  toastMessage: string | null;
  showToast: (msg: string) => void;
  clearError: () => void;

  refresh: () => void;
  handleLoadMore: () => void;
  handleCreateEvent: (data: any) => Promise<void>;
  handlePostComment: (eventId: string, content: string) => Promise<void>;

  handleShareAsNote: (event: any) => Promise<void>;
  handleShareEvent: (event: any) => Promise<void>;
};

/* ----------------------------------------
   Nostr module compatibility layer
---------------------------------------- */

function resolveDefaultRelays(): string[] {
  const n: any = nostr;
  if (Array.isArray(n.DEFAULT_RELAYS) && n.DEFAULT_RELAYS.length) return n.DEFAULT_RELAYS;
  return FALLBACK_RELAYS;
}

function resolvePool(): any | null {
  const n: any = nostr;

  if (typeof n.getPool === "function") return n.getPool();
  if (n.pool) return n.pool;
  if (n.client) return n.client;

  return null;
}

/* ----------------------------------------
   Utilities
---------------------------------------- */

function safeJsonParse<T = any>(text: string): T | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function makeThrottledLogger(intervalMs: number) {
  let last = 0;
  return (msg: string, data?: unknown) => {
    const now = Date.now();
    if (now - last > intervalMs) {
      last = now;
      // eslint-disable-next-line no-console
      console.warn(msg, data);
    }
  };
}

const warnParse = makeThrottledLogger(1500);

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function makeLocalId(prefix = "local") {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function loadOutbox(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return (parsed as any[]).map((it) => ({
      ...it,
      nextAttemptAt: typeof it.nextAttemptAt === "number" ? it.nextAttemptAt : nowSec(),
    })) as OutboxItem[];
  } catch {
    return [];
  }
}

function saveOutbox(items: OutboxItem[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

function computeBackoffSeconds(attempts: number) {
  const base = Math.pow(2, Math.min(10, Math.max(0, attempts))) * 2; // 2,4,8...
  return Math.min(5 * 60, base); // cap at 5 minutes
}

/* ----------------------------------------
   Event Parsing (Robust)
---------------------------------------- */

export function parseAgoraEvent(ev: NostrEvent): AgoraEvent | null {
  const raw = ev.content?.trim?.() ?? "";
  if (!raw) return null;

  const parsed = safeJsonParse<any>(raw);

  if (parsed && typeof parsed === "object") {
    return {
      id: ev.id,
      pubkey: ev.pubkey,
      created_at: ev.created_at,
      title: parsed.title || parsed.name || "(Untitled event)",
      description: parsed.description || parsed.summary || "",
      start:
        typeof parsed.start === "number"
          ? parsed.start
          : typeof parsed.startTimestamp === "number"
            ? parsed.startTimestamp
            : typeof parsed.start_at === "number"
              ? parsed.start_at
              : undefined,
      end: typeof parsed.end === "number" ? parsed.end : undefined,
      location: typeof parsed.location === "string" ? parsed.location : undefined,
      url:
        typeof parsed.url === "string"
          ? parsed.url
          : typeof parsed.landingPageUrl === "string"
            ? parsed.landingPageUrl
            : undefined,
      image_url:
        typeof parsed.image_url === "string"
          ? parsed.image_url
          : typeof parsed.imageUrl === "string"
            ? parsed.imageUrl
            : undefined,
      raw: ev,
    };
  }

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return null;

  warnParse("Agora event content was not JSON; using text fallback", {
    id: ev.id,
    preview: raw.slice(0, 80),
  });

  const urlMatch = raw.match(/https?:\/\/\S+/i);

  return {
    id: ev.id,
    pubkey: ev.pubkey,
    created_at: ev.created_at,
    title: lines[0].slice(0, 140),
    description: lines.slice(1).join("\n").slice(0, 4000),
    url: urlMatch?.[0],
    raw: ev,
  };
}

/* ----------------------------------------
   Async Iterator Normalizer
---------------------------------------- */

async function* toAsyncIterator<T>(
  input: AsyncIterable<T> | Iterable<T> | Promise<Iterable<T>> | Promise<AsyncIterable<T>>
): AsyncGenerator<T> {
  const resolved: any = await input;

  if (resolved?.[Symbol.asyncIterator]) {
    for await (const item of resolved) yield item;
    return;
  }

  if (resolved?.[Symbol.iterator]) {
    for (const item of resolved) yield item;
  }
}

/* ----------------------------------------
   Outbox -> Optimistic Event
---------------------------------------- */

function outboxEventToOptimistic(item: OutboxEventItem, pubkey: string): AgoraEvent {
  const p = item.payload;

  const flags =
    item.status === "queued"
      ? { queued: true }
      : item.status === "publishing"
        ? { publishing: true }
        : item.status === "published"
          ? { published: true }
          : { error: item.lastError || "Failed" };

  return {
    id: item.publishedEventId || item.id,
    pubkey: pubkey || "local",
    created_at: item.created_at,
    title: p.name || "Untitled Gathering",
    description: p.description || "",
    start: p.startTimestamp,
    location: p.location || "Somewhere",
    url: p.landingPageUrl || undefined,
    image_url: p.image_url || undefined,
    raw: {
      id: item.publishedEventId || item.id,
      pubkey: pubkey || "local",
      created_at: item.created_at,
      kind: 31923,
      content: JSON.stringify(p),
      tags: [["start", String(p.startTimestamp)]],
    },
    local: flags,
  };
}

/* ----------------------------------------
   Comment signing/publishing (best effort)
---------------------------------------- */

async function signEventBestEffort(unsignedEvent: any, storedKey: string): Promise<any> {
  const w: any = window as any;

  if (typeof w?.nostr?.signEvent === "function") {
    return await w.nostr.signEvent(unsignedEvent);
  }

  // Optional: if your nostr.ts supports local signing, use it.
  if (typeof (nostr as any)?.signEvent === "function") {
    if (!storedKey) throw new Error("No private key available for local signing");
    return await (nostr as any).signEvent(storedKey, unsignedEvent);
  }

  throw new Error("No signing method available (need window.nostr.signEvent or nostr.signEvent)");
}

async function publishSignedBestEffort(signedEvent: any, relays: string[]): Promise<void> {
  const pool = resolvePool();

  // Many pools expose pool.event(signedEvent)
  if (pool && typeof pool.event === "function") {
    await pool.event(signedEvent, { relays });
    return;
  }

  // Some projects wrap publishing
  if (typeof (nostr as any)?.publishEvent === "function") {
    await (nostr as any).publishEvent(signedEvent, { relays });
    return;
  }

  throw new Error("No publish method available (need pool.event() or nostr.publishEvent())");
}

/* ----------------------------------------
   Hook
---------------------------------------- */

export function useAgoraData(currentUserPubkey?: string): UseAgoraDataResult {
  const relays = resolveDefaultRelays();

  const [events, setEvents] = useState<AgoraEvent[]>([]);
  const [hostProfiles, setHostProfiles] = useState<Record<string, NostrProfile>>({});
  const [comments, setComments] = useState<Record<string, any[]>>({});

  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore] = useState(false);
  const [hasMoreEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [outbox, setOutbox] = useState<OutboxItem[]>(() => loadOutbox());

  const [refreshTick, setRefreshTick] = useState(0);

  const alive = useRef(true);
  const seenIds = useRef<Set<string>>(new Set());
  const outboxWorkerRunning = useRef(false);

  // Prevent “spam signer” warnings/toasts
  const lastNoKeyToastAt = useRef<number>(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToastMessage(null), 2500);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const refresh = useCallback(() => {
    setRefreshTick((n) => n + 1);
    showToast("Refreshing…");
  }, [showToast]);

  /* ----------------------------------------
     On mount: inject queued outbox items into UI
  ---------------------------------------- */
  useEffect(() => {
    const pubkey = currentUserPubkey || "local";

    // optimistic EVENTS
    setEvents((prev) => {
      const prevIds = new Set(prev.map((e) => e.id));
      const optimistic = outbox
        .filter((it) => it.type === "agora_event" && it.status !== "published")
        .map((it) => outboxEventToOptimistic(it as OutboxEventItem, pubkey))
        .filter((e) => !prevIds.has(e.id));

      if (!optimistic.length) return prev;

      const merged = [...optimistic, ...prev];
      merged.sort((a, b) => b.created_at - a.created_at);
      return merged;
    });

    // optimistic COMMENTS (local-only UI)
    setComments((prev) => {
      const next = { ...prev };
      const commentItems = outbox.filter((it) => it.type === "comment" && it.status !== "published") as OutboxCommentItem[];

      for (const it of commentItems) {
        const evId = it.payload.eventId;
        if (!next[evId]) next[evId] = [];

        // avoid duplicates by local id
        if (next[evId].some((c: any) => c.id === it.id)) continue;

        next[evId] = [
          {
            id: it.id,
            pubkey: pubkey,
            created_at: it.created_at,
            content: it.payload.content,
            local: { queued: true },
          },
          ...next[evId],
        ];
      }

      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // once

  /* ----------------------------------------
     Fetch events
  ---------------------------------------- */

  const filters = useMemo(() => {
    return [
      {
        kinds: [31923],
        limit: 200,
      },
    ];
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setError(null);

      try {
        const pool = resolvePool();
        if (!pool?.req) {
          setError("Nostr module error: missing pool.req(). Check src/utils/nostr.ts exports.");
          setIsLoading(false);
          return;
        }

        const iter = pool.req(filters);

        const batch: AgoraEvent[] = [];
        const pubkeys = new Set<string>();

        for await (const msg of toAsyncIterator<any>(iter)) {
          if (cancelled || !alive.current) return;

          if (Array.isArray(msg) && msg[0] === "EVENT") {
            const ev: NostrEvent = msg[2];
            if (!ev?.id || seenIds.current.has(ev.id)) continue;
            seenIds.current.add(ev.id);

            const parsed = parseAgoraEvent(ev);
            if (!parsed) continue;

            batch.push(parsed);
            pubkeys.add(ev.pubkey);
          }

          if (Array.isArray(msg) && msg[0] === "EOSE") break;
        }

        if (cancelled || !alive.current) return;

        // Merge without wiping optimistic items
        setEvents((prev) => {
          const map = new Map(prev.map((e) => [e.id, e] as const));
          for (const e of batch) map.set(e.id, e);
          const merged = Array.from(map.values());
          merged.sort((a, b) => b.created_at - a.created_at);
          return merged;
        });

        setHostProfiles((prev) => {
          const next = { ...prev };
          for (const pk of pubkeys) if (!next[pk]) next[pk] = {};
          return next;
        });

        // prune published outbox events if confirmed by relays
        setOutbox((prev) => {
          const remoteIds = new Set(batch.map((b) => b.id));
          const remaining = prev.filter((it) => {
            if (it.type !== "agora_event") return true;
            const evIt = it as OutboxEventItem;
            return !(evIt.publishedEventId && remoteIds.has(evIt.publishedEventId));
          });
          if (remaining.length !== prev.length) saveOutbox(remaining);
          return remaining;
        });
      } catch (e: any) {
        if (cancelled || !alive.current) return;
        setError(e?.message || "Failed to load events");
      } finally {
        if (cancelled || !alive.current) return;
        setIsLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick, filters]);

  /* ----------------------------------------
     Create Event (Outbox)
  ---------------------------------------- */

  const handleCreateEvent = useCallback(
    async (data: any) => {
      const payload = {
        name: String(data?.name ?? data?.title ?? "").trim() || "Untitled Gathering",
        location: String(data?.location ?? "").trim() || "Somewhere",
        startTimestamp: Number(data?.startTimestamp ?? data?.start ?? 0) || nowSec(),
        description: String(data?.description ?? "").trim(),
        image_url: String(data?.image_url ?? data?.imageUrl ?? "").trim(),
        landingPageUrl: String(data?.landingPageUrl ?? data?.url ?? "").trim(),
      };

      const localId = makeLocalId("agora");

      const item: OutboxEventItem = {
        id: localId,
        created_at: nowSec(),
        type: "agora_event",
        payload,
        status: "queued",
        attempts: 0,
        nextAttemptAt: nowSec(),
      };

      setOutbox((prev) => {
        const next = [item, ...prev];
        saveOutbox(next);
        return next;
      });

      const optimistic = outboxEventToOptimistic(item, currentUserPubkey || "local");

      setEvents((prev) => {
        const merged = [optimistic, ...prev];
        merged.sort((a, b) => b.created_at - a.created_at);
        return merged;
      });

      showToast("Queued. Will post when ready.");
      setRefreshTick((n) => n + 1);
    },
    [currentUserPubkey, showToast]
  );

  /* ----------------------------------------
     Create Comment (Outbox + Optimistic)
  ---------------------------------------- */

  const handlePostComment = useCallback(
    async (eventId: string, content: string) => {
      const text = String(content || "").trim();
      if (!text) return;

      const localId = makeLocalId("cmt");

      const item: OutboxCommentItem = {
        id: localId,
        created_at: nowSec(),
        type: "comment",
        payload: {
          eventId,
          content: text,
          // best effort: find event pubkey if in feed
          eventPubkey: events.find((e) => e.id === eventId || e.raw?.id === eventId)?.pubkey,
        },
        status: "queued",
        attempts: 0,
        nextAttemptAt: nowSec(),
      };

      // persist to outbox
      setOutbox((prev) => {
        const next = [item, ...prev];
        saveOutbox(next);
        return next;
      });

      // optimistic UI: show comment + advance counter immediately
      const pubkey = currentUserPubkey || "local";
      setComments((prev) => {
        const next = { ...prev };
        const arr = next[eventId] ? [...next[eventId]] : [];
        arr.unshift({
          id: localId,
          pubkey,
          created_at: item.created_at,
          content: text,
          local: { queued: true },
        });
        next[eventId] = arr;
        return next;
      });

      showToast("Comment queued. Will post when ready.");
      setRefreshTick((n) => n + 1);
    },
    [currentUserPubkey, events, showToast]
  );

  /* ----------------------------------------
     Outbox worker (events + comments)
  ---------------------------------------- */

  const canAttemptPublish = useCallback(() => {
    const w: any = window as any;
    const hasSigner = typeof w?.nostr?.signEvent === "function";
    const hasLocalKey = typeof (nostr as any)?.getPrivateKey === "function" && !!(nostr as any).getPrivateKey();
    return hasSigner || hasLocalKey;
  }, []);

  const attemptPublishOne = useCallback(
    async (item: OutboxItem): Promise<OutboxItem> => {
      const attempts = item.attempts + 1;
      const storedKey =
        typeof (nostr as any)?.getPrivateKey === "function" ? (nostr as any).getPrivateKey() || "" : "";

      try {
        // --------------------
        // Publish Agora Event
        // --------------------
        if (item.type === "agora_event") {
          const evItem = item as OutboxEventItem;

          if (typeof (nostr as any)?.publishAgoraEvent !== "function") {
            throw new Error("Missing publishAgoraEvent() in src/utils/nostr.ts");
          }

          const signed = await (nostr as any).publishAgoraEvent(storedKey, {
            name: evItem.payload.name,
            startTimestamp: evItem.payload.startTimestamp,
            location: evItem.payload.location,
            description: evItem.payload.description || "",
            image_url: evItem.payload.image_url || "",
            landingPageUrl: evItem.payload.landingPageUrl || "",
          });

          const publishedId = signed?.id;
          if (!publishedId) throw new Error("Publish did not return an event id");

          return {
            ...evItem,
            status: "published",
            attempts,
            publishedEventId: publishedId,
            nextAttemptAt: nowSec(),
          };
        }

        // --------------------
        // Publish Comment (kind 1) with ["e", eventId]
        // --------------------
        const cItem = item as OutboxCommentItem;

        const unsigned = {
          kind: 1,
          created_at: cItem.created_at || nowSec(),
          content: cItem.payload.content,
          tags: [
            ["e", cItem.payload.eventId],
            ...(cItem.payload.eventPubkey ? [["p", cItem.payload.eventPubkey]] : []),
            ["client", "agora"],
          ],
        };

        const signed = await signEventBestEffort(unsigned, storedKey);
        await publishSignedBestEffort(signed, relays);

        const publishedId = signed?.id;
        if (!publishedId) throw new Error("Comment publish did not return an id");

        return {
          ...cItem,
          status: "published",
          attempts,
          publishedEventId: publishedId,
          nextAttemptAt: nowSec(),
        };
      } catch (e: any) {
        const msg = String(e?.message || e);
        const lower = msg.toLowerCase();

        const isNoKey =
          lower.includes("no private key") ||
          lower.includes("private key not found") ||
          lower.includes("nos2x");

        const isConnection =
          lower.includes("websocket") ||
          lower.includes("connect") ||
          lower.includes("relay") ||
          lower.includes("network") ||
          lower.includes("timeout");

        const backoff = computeBackoffSeconds(attempts);

        if (isNoKey) {
          const now = Date.now();
          if (now - lastNoKeyToastAt.current > 10_000) {
            lastNoKeyToastAt.current = now;
            showToast("Can’t post yet. Please unlock/connect your Nostr key.");
          }

          return {
            ...item,
            status: "queued",
            attempts,
            lastError: msg,
            nextAttemptAt: nowSec() + 5 * 60,
          } as OutboxItem;
        }

        if (isConnection) {
          return {
            ...item,
            status: "queued",
            attempts,
            lastError: msg,
            nextAttemptAt: nowSec() + backoff,
          } as OutboxItem;
        }

        return {
          ...item,
          status: "failed",
          attempts,
          lastError: msg,
          nextAttemptAt: nowSec() + backoff,
        } as OutboxItem;
      }
    },
    [relays, showToast]
  );

  useEffect(() => {
    if (outboxWorkerRunning.current) return;
    if (!outbox.length) return;
    if (!canAttemptPublish()) return;

    // Only process items due now
    const due = outbox.some((it) => it.status === "queued" && it.nextAttemptAt <= nowSec());
    if (!due) return;

    outboxWorkerRunning.current = true;
    let cancelled = false;

    const run = async () => {
      try {
        const items = [...outbox].sort((a, b) => a.created_at - b.created_at);

        const updatedById = new Map<string, OutboxItem>();
        let anyChange = false;

        for (const it of items) {
          if (cancelled || !alive.current) return;
          if (it.status !== "queued") continue;
          if (it.nextAttemptAt > nowSec()) continue;

          const updated = await attemptPublishOne(it);
          updatedById.set(it.id, updated);

          if (
            updated.status !== it.status ||
            updated.attempts !== it.attempts ||
            updated.publishedEventId !== (it as any).publishedEventId ||
            updated.nextAttemptAt !== it.nextAttemptAt ||
            updated.lastError !== it.lastError
          ) {
            anyChange = true;
          }

          // Reflect publishes into UI
          if (it.type === "agora_event") {
            const prevPublished = (it as OutboxEventItem).publishedEventId;
            const newPublished = (updated as OutboxEventItem).publishedEventId;

            if (updated.status === "published" && newPublished && newPublished !== prevPublished) {
              setEvents((prev) =>
                prev.map((ev) => {
                  if (ev.id !== it.id) return ev;
                  return {
                    ...ev,
                    id: newPublished,
                    raw: { ...ev.raw, id: newPublished },
                    local: { ...(ev.local || {}), queued: false, published: true },
                  };
                })
              );
              showToast("Posted. Waiting for relays…");
              setRefreshTick((n) => n + 1);
            }
          }

          if (it.type === "comment") {
            const cIt = it as OutboxCommentItem;
            const uIt = updated as OutboxCommentItem;

            if (uIt.status === "published" && uIt.publishedEventId) {
              // Update the optimistic comment id + flags
              setComments((prev) => {
                const next = { ...prev };
                const arr = next[cIt.payload.eventId] ? [...next[cIt.payload.eventId]] : [];
                next[cIt.payload.eventId] = arr.map((c: any) => {
                  if (c.id !== cIt.id) return c;
                  return { ...c, id: uIt.publishedEventId, local: { ...(c.local || {}), queued: false, published: true } };
                });
                return next;
              });
            }

            if (uIt.status === "failed") {
              setComments((prev) => {
                const next = { ...prev };
                const arr = next[cIt.payload.eventId] ? [...next[cIt.payload.eventId]] : [];
                next[cIt.payload.eventId] = arr.map((c: any) => {
                  if (c.id !== cIt.id) return c;
                  return { ...c, local: { ...(c.local || {}), queued: false, error: uIt.lastError || "Failed" } };
                });
                return next;
              });
            }
          }
        }

        if (!anyChange) return;

        setOutbox((prev) => {
          const next = prev.map((p) => updatedById.get(p.id) || p);

          // Drop published items from outbox (UI already has them)
          const pruned = next.filter((x) => x.status !== "published");
          saveOutbox(pruned);
          return pruned;
        });
      } finally {
        outboxWorkerRunning.current = false;
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [outbox, attemptPublishOne, canAttemptPublish, showToast]);

  /* ----------------------------------------
     Stubs (keep HomePage stable)
  ---------------------------------------- */

  const handleLoadMore = useCallback(() => {
    showToast("Load more coming soon!");
  }, [showToast]);

  const handleShareAsNote = useCallback(async () => {
    showToast("Sharing coming soon!");
  }, [showToast]);

  const handleShareEvent = useCallback(async () => {
    showToast("Sharing coming soon!");
  }, [showToast]);

  return {
    events,
    hostProfiles,
    comments,

    isLoading,
    isLoadingMore,
    hasMoreEvents,
    error,

    toastMessage,
    showToast,
    clearError,

    refresh,
    handleLoadMore,
    handleCreateEvent,
    handlePostComment,

    handleShareAsNote,
    handleShareEvent,
  };
}

// --- End of File ---
// Filepath: src/hooks/useAgoraData.ts
// Version: v1.9.2
