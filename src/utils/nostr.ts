// Filepath: src/utils/nostr.ts
// Version: v1.11.0
// Purpose:
// - Robust SINGLETON WebSocket connection manager with relay failover.
// - Provide a minimal Nostr "pool" compatibility layer (pool.req / pool.event) used by hooks/useAgoraData.ts.
// - Added local-key compatibility exports expected by hooks/useAgoraData.ts:
//     - getPrivateKey()
//     - signEvent(privKeyHex, unsignedEvent)
//     - publishAgoraEvent(privKeyHex, payload)
//
// DESIGN NOTES:
// - ONE socket at a time, with relay rotation/backoff.
// - Subscriptions are simple: we send REQ with a generated subId and yield incoming messages for that subId.
// - If relays flap, the caller should call refresh(); beta UX can tolerate that.

import * as nostrTools from "nostr-tools";
import * as auth from "./auth";

type SocketStateHandler = (connected: boolean) => void;

export const DEFAULT_RELAYS: string[] = [
  "wss://relay.nostr.band/",
  "wss://relay.nostr.watch/",
  "wss://relay.nostr.pet/",
  "wss://relay.nostr.h3z.io/",
  "wss://nostr-pub.wellorder.net/",
  "wss://nostr.wine/",
  "wss://nostr.bitcoiner.social/",
];

let ws: WebSocket | null = null;
let currentRelay = 0;
let retryCount = 0;

// If true, we won't auto-retry (used when user logs out / app intentionally stops WS)
let isManuallyClosed = false;

// Used to invalidate callbacks from older sockets.
// Every time we create a new socket, generation increments.
let generation = 0;

let connectionStateHandler: SocketStateHandler | null = null;

export const onWebSocketState = (handler: SocketStateHandler) => {
  connectionStateHandler = handler;
};

const notifyState = (connected: boolean) => {
  try {
    connectionStateHandler?.(connected);
  } catch {
    // swallow handler errors
  }
};

const MAX_BACKOFF = 30000; // 30s cap
const BASE_RETRY = 1000; // start at 1s

function getBackoffDelay(attempt: number) {
  const exp = Math.min(MAX_BACKOFF, BASE_RETRY * Math.pow(2, attempt));
  const jitter = Math.random() * (exp * 0.4); // 0..40% extra jitter
  return exp + jitter;
}

/* ----------------------------------------
   Local key compatibility layer
---------------------------------------- */

/**
 * Used by hooks/useAgoraData.ts to detect local key availability.
 * Returns 64-char hex private key, or null if not present.
 */
export function getPrivateKey(): string | null {
  return auth.getPrivateKeyHex();
}

/**
 * Version-tolerant signing using nostr-tools.
 * Prefers finalizeEvent() when available; otherwise falls back to getEventHash()+signEvent().
 */
export async function signEvent(privKeyHex: string, unsignedEvent: any): Promise<any> {
  const skBytes = auth.hexToBytes(privKeyHex);

  // Fill required fields if missing
  const ev: any = {
    kind: unsignedEvent?.kind,
    created_at: typeof unsignedEvent?.created_at === "number" ? unsignedEvent.created_at : Math.floor(Date.now() / 1000),
    content: typeof unsignedEvent?.content === "string" ? unsignedEvent.content : "",
    tags: Array.isArray(unsignedEvent?.tags) ? unsignedEvent.tags : [],
  };

  // Prefer finalizeEvent (nostr-tools v2+)
  const finalizeEvent = (nostrTools as any)?.finalizeEvent;
  if (typeof finalizeEvent === "function") {
    return finalizeEvent(ev, skBytes);
  }

  // Legacy fallback: getPublicKey + getEventHash + signEvent
  const getPublicKey = (nostrTools as any)?.getPublicKey;
  const getEventHash = (nostrTools as any)?.getEventHash;
  const legacySign = (nostrTools as any)?.signEvent;

  if (typeof getPublicKey !== "function" || typeof getEventHash !== "function" || typeof legacySign !== "function") {
    throw new Error("nostr-tools missing finalizeEvent() and legacy signing helpers");
  }

  const pubkey = String(getPublicKey(skBytes)).toLowerCase();
  const id = getEventHash({ ...ev, pubkey });
  const sig = legacySign({ ...ev, id, pubkey }, skBytes);

  return { ...ev, id, pubkey, sig };
}

/**
 * Publish Agora event (kind 31923) using either:
 * - window.nostr.signEvent (extension) if privKeyHex is empty and signer exists
 * - local signing if privKeyHex provided
 *
 * Returns the signed event object (must include .id).
 */
export async function publishAgoraEvent(privKeyHex: string, payload: {
  name: string;
  startTimestamp: number;
  location: string;
  description?: string;
  image_url?: string;
  landingPageUrl?: string;
}) {
  const created_at = Math.floor(Date.now() / 1000);

  const contentObj: any = {
    // keep both title/name for compatibility with older parsing paths
    title: payload.name,
    name: payload.name,

    location: payload.location,
    description: payload.description || "",

    // keep both keys for compatibility
    image_url: payload.image_url || "",
    imageUrl: payload.image_url || "",

    landingPageUrl: payload.landingPageUrl || "",
    url: payload.landingPageUrl || "",

    // keep both keys for compatibility
    start: payload.startTimestamp,
    startTimestamp: payload.startTimestamp,
  };

  const unsigned: any = {
    kind: 31923,
    created_at,
    content: JSON.stringify(contentObj),
    tags: [
      ["title", String(payload.name || "").slice(0, 140)],
      ["name", String(payload.name || "").slice(0, 140)],
      ["location", String(payload.location || "").slice(0, 240)],
      ["start", String(payload.startTimestamp)],
      ["client", "agora"],
      ...(payload.image_url ? [["image", payload.image_url]] : []),
      ...(payload.landingPageUrl ? [["url", payload.landingPageUrl]] : []),
    ],
  };

  // Prefer browser signer if present + no local key
  const w: any = window as any;
  if (!privKeyHex && typeof w?.nostr?.signEvent === "function") {
    const signed = await w.nostr.signEvent(unsigned);
    await publishEvent(signed);
    return signed;
  }

  if (!privKeyHex) throw new Error("No private key available for local signing");

  const signed = await signEvent(privKeyHex, unsigned);
  await publishEvent(signed);
  return signed;
}

/* ----------------------------------------
   Message routing (subscriptions)
---------------------------------------- */

// For each subId, we store a set of push handlers.
type SubPush = (msg: any) => void;
const subHandlers = new Map<string, Set<SubPush>>();

function safeParse(data: any): any | null {
  try {
    if (typeof data === "string") return JSON.parse(data);
    if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data));
    return null;
  } catch {
    return null;
  }
}

function handleMessage(evt: MessageEvent) {
  const msg = safeParse((evt as any).data);
  if (!msg || !Array.isArray(msg)) return;

  // Expected Nostr wire messages: ["EVENT", subId, event], ["EOSE", subId], ["NOTICE", ...]
  const type = msg[0];
  const subId = typeof msg[1] === "string" ? msg[1] : null;

  if (!subId) return;

  const handlers = subHandlers.get(subId);
  if (!handlers || handlers.size === 0) return;

  // Fan out to all handlers for this subscription id.
  for (const push of handlers) {
    try {
      push(msg);
    } catch {
      // ignore handler errors
    }
  }

  // Auto-cleanup when we see EOSE (end of stored events) for this sub.
  if (type === "EOSE") {
    // The iterator will call CLOSE() and cleanup.
  }
}

function sendRaw(payload: any) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

async function waitForOpen(timeoutMs = 12000): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (ws && ws.readyState === WebSocket.OPEN) return true;

    // If no socket or not connecting, try to connect.
    connectToWebSocket();

    // Small sleep
    await new Promise((r) => setTimeout(r, 150));
  }

  return Boolean(ws && ws.readyState === WebSocket.OPEN);
}

/* ----------------------------------------
   WebSocket lifecycle
---------------------------------------- */

/**
 * Close any existing socket and prevent retries until connectToWebSocket is called again.
 * Useful for logout flows or hard resets.
 */
export function closeWebSocket() {
  isManuallyClosed = true;
  retryCount = 0;
  currentRelay = 0;

  // Drop all subscription handlers (they will re-REQ on refresh)
  subHandlers.clear();

  if (ws) {
    try {
      ws.onopen = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.onmessage = null;
      ws.close();
    } catch {}
  }

  ws = null;
  notifyState(false);
}

/**
 * Connect to the relay pool (singleton).
 * Safe to call multiple times; it won't create duplicate sockets.
 */
export function connectToWebSocket() {
  if (isManuallyClosed) {
    // If someone previously called closeWebSocket(), they must explicitly reconnect by resetting flag.
    isManuallyClosed = false;
  }

  // ✅ CRITICAL DEDUPE:
  // If we already have an OPEN or CONNECTING socket, do NOT create another.
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const myGen = ++generation;
  const url = DEFAULT_RELAYS[currentRelay];

  ws = new WebSocket(url);

  ws.onopen = () => {
    // Ignore events from stale sockets (in case a previous one fires late)
    if (myGen !== generation) return;

    console.log(`[WS] connected to ${url}`);
    retryCount = 0;
    notifyState(true);
  };

  ws.onmessage = (evt) => {
    if (myGen !== generation) return;
    handleMessage(evt);
  };

  ws.onerror = (error) => {
    if (myGen !== generation) return;

    console.warn(`[WS] error on ${url}`, error);
    notifyState(false);
    handleWebSocketFailure(myGen);
  };

  ws.onclose = (event) => {
    if (myGen !== generation) return;

    console.warn(`[WS] closed on ${url}`, event);
    notifyState(false);
    handleWebSocketFailure(myGen);
  };
}

// Handle failure with relay rotation + backoff.
// The generation check ensures old sockets don't schedule retries after a newer socket exists.
function handleWebSocketFailure(myGen: number) {
  if (isManuallyClosed) return;
  if (myGen !== generation) return;

  // Rotate relay
  currentRelay = (currentRelay + 1) % DEFAULT_RELAYS.length;
  retryCount++;

  // After we've tried each relay once, keep cycling but slow down.
  const delay = getBackoffDelay(Math.min(retryCount, 6));

  console.log(`[WS] retry #${retryCount} in ${(delay / 1000).toFixed(1)}s via ${DEFAULT_RELAYS[currentRelay]}`);

  setTimeout(() => {
    // Ensure we didn't get replaced while waiting.
    if (isManuallyClosed) return;
    if (myGen !== generation) return;

    connectToWebSocket();
  }, delay);
}

/* ----------------------------------------
   Pool compatibility layer
---------------------------------------- */

function makeSubId(prefix = "sub") {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function createAsyncQueue<T>() {
  const q: T[] = [];
  let resolveNext: ((v: IteratorResult<T>) => void) | null = null;
  let done = false;

  const push = (item: T) => {
    if (done) return;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: item, done: false });
      return;
    }
    q.push(item);
  };

  const end = () => {
    if (done) return;
    done = true;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: undefined as any, done: true });
    }
  };

  const iterator: AsyncIterableIterator<T> = {
    [Symbol.asyncIterator]() {
      return iterator;
    },
    next() {
      if (q.length > 0) {
        const value = q.shift()!;
        return Promise.resolve({ value, done: false });
      }
      if (done) return Promise.resolve({ value: undefined as any, done: true });

      return new Promise<IteratorResult<T>>((resolve) => {
        resolveNext = resolve;
      });
    },
    return() {
      end();
      return Promise.resolve({ value: undefined as any, done: true });
    },
    throw(err?: any) {
      end();
      return Promise.reject(err);
    },
  };

  return { push, end, iterator };
}

async function closeSub(subId: string) {
  // best-effort close message
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendRaw(["CLOSE", subId]);
  }
  subHandlers.delete(subId);
}

/**
 * Minimal pool surface:
 * - req(filters): returns an AsyncIterableIterator of raw Nostr messages (arrays)
 * - event(ev): publishes ["EVENT", ev]
 */
function createPool() {
  return {
    /**
     * Request events for given filters.
     * Returns an async iterator yielding raw messages like:
     * ["EVENT", subId, event], ["EOSE", subId]
     */
    req(filters: any) {
      const subId = makeSubId("req");
      const { push, end, iterator } = createAsyncQueue<any>();

      const handler: SubPush = (msg) => {
        push(msg);

        // Default behavior: stop iteration when we see EOSE.
        if (Array.isArray(msg) && msg[0] === "EOSE") {
          // Close + cleanup in a microtask so consumer receives EOSE first.
          queueMicrotask(async () => {
            await closeSub(subId);
            end();
          });
        }
      };

      const set = subHandlers.get(subId) ?? new Set<SubPush>();
      set.add(handler);
      subHandlers.set(subId, set);

      // Fire-and-forget the REQ after socket is open (or opening).
      (async () => {
        const ok = await waitForOpen();
        if (!ok) {
          // push an EOSE-like end so consumer doesn't hang forever
          push(["EOSE", subId]);
          await closeSub(subId);
          end();
          return;
        }

        // Nostr REQ format: ["REQ", subId, ...filters]
        const f = Array.isArray(filters) ? filters : [filters];
        sendRaw(["REQ", subId, ...f]);
      })();

      // Ensure cleanup if consumer breaks early
      const wrapped: AsyncIterableIterator<any> = {
        [Symbol.asyncIterator]() {
          return wrapped;
        },
        async next() {
          return iterator.next();
        },
        async return() {
          await closeSub(subId);
          return iterator.return ? iterator.return() : Promise.resolve({ value: undefined as any, done: true });
        },
        async throw(err?: any) {
          await closeSub(subId);
          return iterator.throw ? iterator.throw(err) : Promise.reject(err);
        },
      };

      return wrapped;
    },

    /**
     * Publish an event to the current relay socket.
     * Signature matches useAgoraData.ts expectation: pool.event(signedEvent, { relays })
     * We ignore relays here because this socket already rotates through DEFAULT_RELAYS.
     */
    async event(signedEvent: any, _opts?: { relays?: string[] }) {
      const ok = await waitForOpen();
      if (!ok) throw new Error("No relay connection available");

      // Nostr EVENT format: ["EVENT", <eventObject>]
      const sent = sendRaw(["EVENT", signedEvent]);
      if (!sent) throw new Error("Failed to send event");
      return true;
    },
  };
}

let poolSingleton: any | null = null;

/**
 * Public getter used by hooks/useAgoraData.ts resolvePool().
 */
export function getPool() {
  if (!poolSingleton) poolSingleton = createPool();
  return poolSingleton;
}

// Also export `pool` for legacy compatibility.
export const pool = getPool();

/**
 * Legacy helper used by some code paths: publishEvent(event, { relays }).
 * hooks/useAgoraData.ts falls back to this if pool.event is missing.
 */
export async function publishEvent(signedEvent: any, _opts?: { relays?: string[] }) {
  return pool.event(signedEvent, _opts);
}

// --- End of File ---
// Filepath: src/utils/nostr.ts
// Version: v1.11.0
