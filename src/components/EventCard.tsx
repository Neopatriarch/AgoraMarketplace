// Filepath: src/components/EventCard.tsx
// Author: Robert Kirkpatrick
// Updated by: ChatGPT
// Version: v1.5.2
// Purpose:
// - Robust image + time detection from JSON, tags, and description
// - Fix "Time not specified" when start is stored in tags
// - Support all-day events (date-only display)
// - Graceful image loading failures (show warm 420×750 postcard placeholder + watermark)
// - NEVER show a broken-image link in-card (keeps the “postcard” feel)
// - Cleanup: remove accidental duplicated file content/footer to prevent human error

import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';

interface EventCardProps {
  event: any;
  hostName: string;
  currentUserPubkey: string;
  startTime?: DateTime; // optional; EventCard will compute if missing
  isAttending: boolean;
  comments: any[];
  onToggleRSVP: (eventId: string, event: any, onOpenShareModal?: () => void) => void;
  onPostComment: (eventId: string, content: string) => void;
  onShareAsNote: (event: any) => void;
  onShareEvent: (event: any) => void;
  onZap?: (event: any) => void;
}

const renderContentWithImages = (text: string): React.ReactNode[] => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partIndex = 0;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`text-${partIndex++}`}>{text.substring(lastIndex, match.index)}</span>);
    }

    const url = match[0];
    if (/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i.test(url)) {
      parts.push(
        <img
          key={`img-${partIndex++}`}
          src={url}
          alt="Embedded"
          style={{
            maxWidth: '100%',
            height: 'auto',
            borderRadius: '12px',
            margin: '12px 0',
            display: 'block',
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      );
    } else {
      parts.push(
        <a
          key={`link-${partIndex++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#007bff' }}
        >
          {url}
        </a>
      );
    }

    lastIndex = urlRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`text-${partIndex++}`}>{text.substring(lastIndex)}</span>);
  }

  return parts;
};

function getTagValue(tags: any, name: string): string | undefined {
  if (!Array.isArray(tags)) return undefined;
  const found = tags.find((t: any[]) => Array.isArray(t) && t[0] === name);
  return found?.[1];
}

// Converts common “page” URLs into “direct image” URLs when it’s obvious.
// (Not perfect, but it helps a lot.)
function normalizeImageUrl(url: string): string {
  const u = (url || '').trim();
  if (!u) return '';

  // If already a direct image, keep it.
  if (/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i.test(u)) return u;

  // Imgur page -> i.imgur direct (best-effort: assume .jpg)
  // https://imgur.com/abcd  -> https://i.imgur.com/abcd.jpg
  // https://imgur.com/gallery/abcd -> https://i.imgur.com/abcd.jpg
  const imgurMatch = u.match(/^https?:\/\/(www\.)?imgur\.com\/(?:gallery\/)?([A-Za-z0-9]+)(?:\?.*)?$/i);
  if (imgurMatch?.[2]) {
    return `https://i.imgur.com/${imgurMatch[2]}.jpg`;
  }

  return u;
}

function firstImageUrlFromText(text: string): string {
  const raw = (text || '').trim();
  if (!raw) return '';
  const m = raw.match(/https?:\/\/\S+\.(jpeg|jpg|gif|png|webp)(\?\S*)?/i);
  return m?.[0] ? m[0] : '';
}

type EventData = {
  name: string;
  location: string;
  description: string;
  image_url: string;
  landingPageUrl: string;
  start?: number; // seconds
  end?: number; // seconds
  allDay?: boolean;
};

function safeParseEventData(event: any): EventData {
  // Defaults
  const data: EventData = {
    name: 'Untitled Gathering',
    location: 'Somewhere',
    description: '',
    image_url: '',
    landingPageUrl: '',
  };

  // 1) Try JSON content
  try {
    const parsed = JSON.parse(event?.content || '{}');
    if (parsed && typeof parsed === 'object') {
      data.name = parsed.name || parsed.title || data.name;
      data.location = parsed.location || data.location;
      data.description = parsed.description || parsed.summary || '';
      data.image_url = parsed.image_url || parsed.imageUrl || '';
      data.landingPageUrl = parsed.landingPageUrl || parsed.url || '';

      // timestamps may be seconds or ms; normalize to seconds
      const startCandidate = parsed.start ?? parsed.start_at ?? parsed.startTimestamp ?? parsed.start_timestamp ?? undefined;
      const endCandidate = parsed.end ?? parsed.end_at ?? parsed.endTimestamp ?? parsed.end_timestamp ?? undefined;

      const toSeconds = (v: any) => {
        if (typeof v !== 'number') return undefined;
        return v > 2_000_000_000 ? Math.floor(v / 1000) : v;
      };

      data.start = toSeconds(startCandidate);
      data.end = toSeconds(endCandidate);

      if (parsed.allDay === true || parsed.all_day === true) data.allDay = true;
    }
  } catch {
    // ignore; we’ll use tags + raw text fallback below
  }

  // 2) Tags fallback (works for both JSON and non-JSON events)
  const tags = event?.tags;

  const tagTitle = getTagValue(tags, 'title') || getTagValue(tags, 'name');
  if (tagTitle && (!data.name || data.name === 'Untitled Gathering')) data.name = tagTitle;

  const tagLocation = getTagValue(tags, 'location');
  if (tagLocation && (!data.location || data.location === 'Somewhere')) data.location = tagLocation;

  const tagImage = getTagValue(tags, 'image') || getTagValue(tags, 'image_url') || getTagValue(tags, 'imageUrl');
  if (tagImage && !data.image_url) data.image_url = tagImage;

  const tagUrl = getTagValue(tags, 'url') || getTagValue(tags, 'landingPageUrl');
  if (tagUrl && !data.landingPageUrl) data.landingPageUrl = tagUrl;

  const tagStart = getTagValue(tags, 'start');
  if (tagStart && !data.start) {
    const n = Number(tagStart);
    if (!Number.isNaN(n)) data.start = n > 2_000_000_000 ? Math.floor(n / 1000) : n;
  }

  const tagEnd = getTagValue(tags, 'end');
  if (tagEnd && !data.end) {
    const n = Number(tagEnd);
    if (!Number.isNaN(n)) data.end = n > 2_000_000_000 ? Math.floor(n / 1000) : n;
  }

  const tagAllDay = getTagValue(tags, 'all_day') || getTagValue(tags, 'allDay');
  if (tagAllDay === '1' || tagAllDay === 'true') data.allDay = true;

  // 3) Plain-text fallback: if description is empty, use event.content
  if (!data.description) {
    const raw = (event?.content || '').trim();
    data.description = raw;
  }

  // 4) Image fallback: first image URL inside description
  if (!data.image_url) {
    const fromText = firstImageUrlFromText(data.description);
    if (fromText) data.image_url = fromText;
  }

  // Normalize image URL for common cases (imgur pages etc.)
  data.image_url = normalizeImageUrl(data.image_url);

  return data;
}

const PlaceholderPostcard: React.FC = () => {
  return (
    <div
      style={{
        width: '100%',
        aspectRatio: '420 / 750',
        borderRadius: '16px',
        marginBottom: '16px',
        position: 'relative',
        overflow: 'hidden',
        background:
          'linear-gradient(135deg, rgba(255,214,165,0.95) 0%, rgba(255,182,193,0.85) 45%, rgba(196,224,255,0.85) 100%)',
      }}
    >
      {/* Soft “illustration” */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.22,
          transform: 'translateY(-6px)',
        }}
      >
        <svg width="140" height="140" viewBox="0 0 64 64" aria-hidden="true">
          <path
            d="M32 58s18-18 18-32C50 15 42.8 8 32 8S14 15 14 26c0 14 18 32 18 32z"
            fill="black"
          />
          <circle cx="32" cy="26" r="8" fill="white" />
          <circle cx="22" cy="44" r="5" fill="black" />
          <circle cx="42" cy="44" r="5" fill="black" />
        </svg>
      </div>

      {/* Watermark */}
      <div
        style={{
          position: 'absolute',
          right: 10,
          bottom: 10,
          fontSize: 12,
          color: 'rgba(0,0,0,0.35)',
          fontWeight: 500,
          letterSpacing: 0.2,
          userSelect: 'none',
        }}
      >
        shared via Agora Marketplace
      </div>
    </div>
  );
};

const EventCard: React.FC<EventCardProps> = ({
  event,
  hostName,
  currentUserPubkey,
  startTime,
  isAttending,
  comments,
  onToggleRSVP,
  onPostComment,
  onShareAsNote,
  onShareEvent,
  onZap,
}) => {
  const [isCommenting, setIsCommenting] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [imageOk, setImageOk] = useState(true);

  const eventData = useMemo(() => safeParseEventData(event), [event]);

  // Compute start time if not provided
  const computedStart = useMemo(() => {
    if (startTime) return startTime;
    if (typeof eventData.start === 'number') return DateTime.fromSeconds(eventData.start);
    return null;
  }, [startTime, eventData.start]);

  const computedEnd = useMemo(() => {
    if (typeof eventData.end === 'number') return DateTime.fromSeconds(eventData.end);
    return null;
  }, [eventData.end]);

  const whenText = useMemo(() => {
    if (!computedStart) return 'Time not specified';

    // All-day: show date only
    if (eventData.allDay) {
      return computedStart.toLocaleString(DateTime.DATE_FULL);
    }

    // Timed event:
    if (computedEnd) {
      if (computedStart.hasSame(computedEnd, 'day')) {
        return `${computedStart.toLocaleString(DateTime.DATETIME_FULL)} – ${computedEnd.toLocaleString(DateTime.TIME_SIMPLE)}`;
      }
      return `${computedStart.toLocaleString(DateTime.DATETIME_FULL)} – ${computedEnd.toLocaleString(
        DateTime.DATETIME_FULL
      )}`;
    }

    return computedStart.toLocaleString(DateTime.DATETIME_FULL);
  }, [computedStart, computedEnd, eventData.allDay]);

  const displayHostName = (() => {
    if (event?.pubkey === currentUserPubkey) {
      const savedName = localStorage.getItem('agora_displayName');
      return savedName && savedName.trim() ? savedName.trim() : hostName;
    }
    return hostName || `${(event?.pubkey || '').substring(0, 8)}...`;
  })();

  const handlePostCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;

    setIsPostingComment(true);
    await onPostComment(event.id, commentText);
    setCommentText('');
    setIsCommenting(false);
    setIsPostingComment(false);
  };

  const handleZapClick = () => {
    if (!onZap) return;
    onZap(event);
  };

  const shouldShowRemoteImage = Boolean(eventData.image_url) && imageOk;

  return (
    <div
      style={{
        background: '#1e1e1e',
        borderRadius: '20px',
        padding: '20px',
        marginBottom: '24px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
      }}
    >
      {/* Postcard header (always 420×750) */}
      {shouldShowRemoteImage ? (
        <div
          style={{
            width: '100%',
            aspectRatio: '420 / 750',
            borderRadius: '16px',
            marginBottom: '16px',
            position: 'relative',
            overflow: 'hidden',
            background: '#222',
          }}
        >
          <img
            src={eventData.image_url}
            alt={eventData.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
            onError={() => {
              // Common: GitHub "private-user-images" links require auth + expire => 404.
              // In MVP, we NEVER show a broken image; we fall back to the warm placeholder.
              setImageOk(false);
            }}
          />
          <div
            style={{
              position: 'absolute',
              right: 10,
              bottom: 10,
              fontSize: 12,
              color: 'rgba(255,255,255,0.55)',
              fontWeight: 500,
              letterSpacing: 0.2,
              userSelect: 'none',
              textShadow: '0 1px 2px rgba(0,0,0,0.35)',
            }}
          >
            shared via Agora Marketplace
          </div>
        </div>
      ) : (
        <PlaceholderPostcard />
      )}

      <h3 style={{ fontSize: '22px', margin: '0 0 12px 0', color: '#f5f5f5' }}>{eventData.name}</h3>

      <p style={{ margin: '8px 0', opacity: 0.9, color: '#bbbbbb' }}>
        <strong>Hosted by:</strong> {displayHostName}
      </p>

      <p style={{ margin: '8px 0', color: '#bbbbbb' }}>
        <strong>Where:</strong> {eventData.location}
      </p>

      <p style={{ margin: '8px 0', color: '#bbbbbb' }}>
        <strong>When:</strong> {whenText}
      </p>

      {eventData.description && (
        <p style={{ margin: '16px 0', lineHeight: '1.5', color: '#f5f5f5' }}>
          {renderContentWithImages(eventData.description)}
        </p>
      )}

      {eventData.landingPageUrl && eventData.landingPageUrl.trim() && (
        <p style={{ margin: '16px 0' }}>
          <a
            href={eventData.landingPageUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#007bff', fontWeight: '500' }}
          >
            🌐 Visit official event page
          </a>
        </p>
      )}

      <div style={{ display: 'flex', gap: '12px', margin: '20px 0', alignItems: 'center' }}>
        <button
          onClick={() => onToggleRSVP(event.id, event)}
          disabled={isPostingComment}
          style={{
            flex: 1,
            padding: '14px',
            fontSize: '16px',
            borderRadius: '12px',
            background: isAttending ? '#333' : '#000',
            color: '#fff',
            border: 'none',
          }}
        >
          {isAttending ? 'Going ✓' : 'I’m going'}
        </button>

        <button
          onClick={handleZapClick}
          disabled={!onZap || isPostingComment}
          aria-label="Say thanks"
          title={onZap ? 'Say thanks' : 'Coming soon'}
          style={{
            padding: '14px 16px',
            fontSize: '18px',
            borderRadius: '12px',
            background: '#333',
            color: '#f5f5f5',
            border: 'none',
            opacity: !onZap ? 0.5 : 1,
          }}
        >
          ⚡
        </button>

        <button
          onClick={() => onShareAsNote(event)}
          disabled={isPostingComment}
          style={{
            padding: '14px 20px',
            fontSize: '16px',
            borderRadius: '12px',
            background: '#333',
            color: '#f5f5f5',
            border: 'none',
          }}
        >
          Share Note
        </button>

        <button
          onClick={() => onShareEvent(event)}
          disabled={isPostingComment}
          style={{
            padding: '14px 20px',
            fontSize: '16px',
            borderRadius: '12px',
            background: '#333',
            color: '#f5f5f5',
            border: 'none',
          }}
        >
          Share Card
        </button>
      </div>

      <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #444' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#f5f5f5' }}>
          Comments ({comments.length})
        </h4>

        {!isCommenting ? (
          <button
            onClick={() => setIsCommenting(true)}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              background: 'transparent',
              border: '1px solid #666',
              borderRadius: '12px',
              color: '#ccc',
            }}
          >
            Add comment
          </button>
        ) : (
          <form onSubmit={handlePostCommentSubmit} style={{ marginBottom: '16px' }}>
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Say something nice..."
              rows={3}
              required
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '12px',
                border: '1px solid #444',
                background: '#2a2a2a',
                color: '#f5f5f5',
                fontSize: '15px',
                resize: 'none',
              }}
            />

            <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
              <button
                type="submit"
                disabled={isPostingComment}
                style={{
                  padding: '10px 16px',
                  background: '#000',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                }}
              >
                Post
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCommenting(false);
                  setCommentText('');
                }}
                style={{
                  padding: '10px 16px',
                  background: 'transparent',
                  border: '1px solid #666',
                  borderRadius: '8px',
                  color: '#ccc',
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {comments.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {comments.map((c: any) => (
              <div
                key={c?.id || Math.random().toString(36)}
                style={{
                  background: '#2a2a2a',
                  border: '1px solid #3a3a3a',
                  borderRadius: 12,
                  padding: 12,
                  color: '#f5f5f5',
                  fontSize: 14,
                }}
              >
                {String(c?.content || '')}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default EventCard;

// --- End of File ---
// Filepath: src/components/EventCard.tsx
// Version: v1.5.2
