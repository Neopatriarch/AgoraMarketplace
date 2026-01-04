// Filepath: src/utils/share.ts
// Author: ChatGPT (for Robert Kirkpatrick)
// Version: v1.0.0
// Purpose: Event-first share builder + native share + clipboard fallback (includes images when possible)

import { DateTime } from 'luxon';

type AnyEvent = any;

export type ParsedShareEvent = {
  id: string;
  pubkey: string;
  title: string;
  location: string;
  whenText: string;
  description: string;
  imageUrl: string;
  landingUrl: string;
};

const BRAND_LINE = '— Shared via Agora Marketplace';

const safeGetTag = (event: AnyEvent, name: string): string => {
  try {
    return event?.tags?.find((t: any[]) => t?.[0] === name)?.[1] || '';
  } catch {
    return '';
  }
};

export const parseEventForSharing = (event: AnyEvent): ParsedShareEvent => {
  // event may be {raw} or already raw
  const ev = event?.raw || event;

  let title = 'Untitled Gathering';
  let location = 'Somewhere';
  let description = '';
  let imageUrl = '';
  let landingUrl = '';

  // "When" comes from tag start (seconds)
  const startTag = safeGetTag(ev, 'start');
  let whenText = 'Time not specified';
  if (startTag) {
    const asNum = Number(startTag);
    if (!Number.isNaN(asNum) && asNum > 0) {
      whenText = DateTime.fromSeconds(asNum).toLocaleString(DateTime.DATETIME_FULL);
    }
  }

  // Prefer JSON content
  try {
    const content = JSON.parse(ev?.content || '{}');
    title = content?.name || content?.title || title;
    location = content?.location || location;
    description = content?.description || '';
    imageUrl = content?.image_url || content?.image || '';
    landingUrl = content?.landingPageUrl || content?.url || '';
  } catch {
    // Fallback to tags/content
    title = safeGetTag(ev, 'title') || safeGetTag(ev, 'name') || title;
    location = safeGetTag(ev, 'location') || location;
    description = typeof ev?.content === 'string' ? ev.content : '';
    imageUrl = safeGetTag(ev, 'image') || safeGetTag(ev, 'image_url') || '';
    landingUrl = safeGetTag(ev, 'url') || '';
  }

  // If image exists in tags but not content, prefer it
  if (!imageUrl) imageUrl = safeGetTag(ev, 'image') || safeGetTag(ev, 'image_url') || '';

  return {
    id: ev?.id || '',
    pubkey: ev?.pubkey || '',
    title: String(title || 'Untitled Gathering'),
    location: String(location || 'Somewhere'),
    whenText,
    description: String(description || ''),
    imageUrl: String(imageUrl || ''),
    landingUrl: String(landingUrl || ''),
  };
};

export type ShareBuildOptions = {
  // Optional human text, e.g. "Mom let's go..." or "Who is up for taco night?"
  message?: string;

  // If true, include image URL in share text when present (default true)
  includeImageUrl?: boolean;

  // If true, include landing URL when present (default true)
  includeLandingUrl?: boolean;
};

export const buildShareText = (parsed: ParsedShareEvent, opts: ShareBuildOptions = {}): string => {
  const includeImageUrl = opts.includeImageUrl !== false;
  const includeLandingUrl = opts.includeLandingUrl !== false;

  const lines: string[] = [];

  // Event FIRST (your requirement)
  lines.push(parsed.title);
  lines.push(`When: ${parsed.whenText}`);
  lines.push(`Where: ${parsed.location}`);

  // Optional description
  const desc = (parsed.description || '').trim();
  if (desc) {
    lines.push('');
    lines.push(desc);
  }

  // Optional message (can be placed after event details; still event-first)
  const msg = (opts.message || '').trim();
  if (msg) {
    lines.push('');
    lines.push(msg);
  }

  // Links
  if (includeLandingUrl && parsed.landingUrl?.trim()) {
    lines.push('');
    lines.push(`More info: ${parsed.landingUrl.trim()}`);
  }

  if (includeImageUrl && parsed.imageUrl?.trim()) {
    lines.push('');
    lines.push(parsed.imageUrl.trim());
  }

  // Branding LAST (your requirement)
  lines.push('');
  lines.push(BRAND_LINE);

  return lines.join('\n');
};

export const buildNativeSharePayload = (
  parsed: ParsedShareEvent,
  opts: ShareBuildOptions = {}
): { title: string; text: string; url?: string } => {
  const text = buildShareText(parsed, opts);
  // Prefer landing url for system share url field (improves previews)
  const url = parsed.landingUrl?.trim() || undefined;
  return { title: parsed.title, text, url };
};

export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  // Fallback old-school copy
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

export const shareViaSystem = async (
  payload: { title: string; text: string; url?: string }
): Promise<'shared' | 'clipboard' | 'unsupported' | 'failed'> => {
  try {
    // Web Share API
    if ((navigator as any)?.share) {
      await (navigator as any).share(payload);
      return 'shared';
    }
    // No native share: clipboard fallback
    const ok = await copyToClipboard(payload.text);
    return ok ? 'clipboard' : 'unsupported';
  } catch {
    // User cancelled share sheet, etc. Still treat as "failed" (no toast spam)
    return 'failed';
  }
};

export const buildNostrNoteUnsigned = (
  parsed: ParsedShareEvent,
  authorPubkey: string,
  opts: ShareBuildOptions = {}
) => {
  const content = buildShareText(parsed, opts);

  // Tag the original event + author (helps clients correlate)
  const tags: any[] = [];
  if (parsed.id) tags.push(['e', parsed.id]);
  if (parsed.pubkey) tags.push(['p', parsed.pubkey]);
  // Helpful hint that this note references a 31923 event (optional)
  tags.push(['k', '31923']);

  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: authorPubkey,
    tags,
    content,
  };
};
