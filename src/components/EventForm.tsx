// Filepath: src/components/EventForm.tsx
// Author: Robert Kirkpatrick
// Updated by: ChatGPT
// Version: v1.1.1
// Purpose:
// - Build a create-event payload that matches useAgoraData.handleCreateEvent expectations
// - Ensure startTimestamp is a numeric unix timestamp (seconds)
// - Store image under image_url (so EventCard can reliably render it)
// - Include landingPageUrl (and url alias) for sharing
// - Keep optional all-day UI, but ensure it still produces a valid startTimestamp (midnight local)
//   NOTE: allDay is included in the payload for forward-compat, but current useAgoraData may ignore it
// - Best-effort normalization for common image page URLs (e.g., imgur -> i.imgur direct)

import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';

interface EventFormProps {
  onSubmit: (eventDraft: any) => Promise<void>;
  onCancel: () => void;
  onSuccess: () => void;
}

function normalizeImageUrl(url: string): string {
  const u = (url || '').trim();
  if (!u) return '';

  // Already a direct image
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

function toUnixSecondsFromLocalISO(iso: string): number | null {
  const dt = DateTime.fromISO(iso, { zone: 'local' });
  if (!dt.isValid) return null;
  return Math.floor(dt.toSeconds());
}

function toUnixSecondsFromLocalDate(dateISO: string): number | null {
  // dateISO is "YYYY-MM-DD"
  const dt = DateTime.fromISO(dateISO, { zone: 'local' }).startOf('day');
  if (!dt.isValid) return null;
  return Math.floor(dt.toSeconds());
}

const EventForm: React.FC<EventFormProps> = ({ onSubmit, onCancel, onSuccess }) => {
  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(false);

  // For timed events: datetime-local ("YYYY-MM-DDTHH:mm")
  const [dateTimeLocal, setDateTimeLocal] = useState('');
  // For all-day events: date ("YYYY-MM-DD")
  const [dateOnly, setDateOnly] = useState('');

  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [landingPageUrl, setLandingPageUrl] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startTimestamp = useMemo(() => {
    if (allDay) return toUnixSecondsFromLocalDate(dateOnly);
    return toUnixSecondsFromLocalISO(dateTimeLocal);
  }, [allDay, dateOnly, dateTimeLocal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    if (allDay) {
      if (!dateOnly.trim()) {
        setError('Date is required for an all-day gathering');
        return;
      }
    } else {
      if (!dateTimeLocal.trim()) {
        setError('Date/time is required');
        return;
      }
    }

    if (startTimestamp == null) {
      setError('That date/time looks invalid. Please try again.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const normalizedImage = normalizeImageUrl(imageUrl);
      const normalizedLanding = (landingPageUrl || '').trim();

      // IMPORTANT:
      // useAgoraData.handleCreateEvent reads:
      // - name/title
      // - location (optional; it defaults to "Somewhere" if blank)
      // - startTimestamp (seconds)
      // - description
      // - image_url
      // - landingPageUrl / url
      const payload = {
        // accept either name or title upstream (we send both)
        name: title.trim(),
        title: title.trim(),

        // allow blank; upstream can default to "Somewhere"
        location: (location || '').trim(),

        description: (description || '').trim(),

        // prefer image_url for EventCard + parsing
        image_url: normalizedImage,

        // Optional: landing page URL (EventCard supports landingPageUrl or url)
        landingPageUrl: normalizedLanding,
        url: normalizedLanding,

        // required by useAgoraData
        startTimestamp,

        // forward-compat flag(s) for date-only rendering (may be ignored upstream today)
        allDay: Boolean(allDay),
        all_day: Boolean(allDay),
      };

      await onSubmit(payload);
      onSuccess();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Create failed', err);
      setError('Failed to create gathering. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        disabled={isSubmitting}
        style={{
          padding: '16px',
          fontSize: '20px',
          borderRadius: '12px',
          border: '1px solid #444',
          background: '#2a2a2a',
          color: '#f5f5f5',
        }}
      />

      <input
        type="text"
        placeholder="Location (optional)"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        disabled={isSubmitting}
        style={{
          padding: '16px',
          fontSize: '18px',
          borderRadius: '12px',
          border: '1px solid #444',
          background: '#2a2a2a',
          color: '#f5f5f5',
        }}
      />

      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#cccccc', fontSize: '14px' }}>
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          disabled={isSubmitting}
        />
        All-day gathering
      </label>

      {allDay ? (
        <input
          type="date"
          value={dateOnly}
          onChange={(e) => setDateOnly(e.target.value)}
          required
          disabled={isSubmitting}
          style={{
            padding: '16px',
            fontSize: '18px',
            borderRadius: '12px',
            border: '1px solid #444',
            background: '#2a2a2a',
            color: '#f5f5f5',
          }}
        />
      ) : (
        <input
          type="datetime-local"
          value={dateTimeLocal}
          onChange={(e) => setDateTimeLocal(e.target.value)}
          required
          disabled={isSubmitting}
          style={{
            padding: '16px',
            fontSize: '18px',
            borderRadius: '12px',
            border: '1px solid #444',
            background: '#2a2a2a',
            color: '#f5f5f5',
          }}
        />
      )}

      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        disabled={isSubmitting}
        style={{
          padding: '16px',
          fontSize: '16px',
          borderRadius: '12px',
          border: '1px solid #444',
          background: '#2a2a2a',
          color: '#f5f5f5',
          resize: 'none',
        }}
      />

      <input
        type="url"
        placeholder="Image URL (optional)"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        onBlur={() => setImageUrl((v) => normalizeImageUrl(v))}
        disabled={isSubmitting}
        style={{
          padding: '16px',
          fontSize: '16px',
          borderRadius: '12px',
          border: '1px solid #444',
          background: '#2a2a2a',
          color: '#f5f5f5',
        }}
      />

      <input
        type="url"
        placeholder="Official event page URL (optional)"
        value={landingPageUrl}
        onChange={(e) => setLandingPageUrl(e.target.value)}
        disabled={isSubmitting}
        style={{
          padding: '16px',
          fontSize: '16px',
          borderRadius: '12px',
          border: '1px solid #444',
          background: '#2a2a2a',
          color: '#f5f5f5',
        }}
      />

      {error && <p style={{ color: '#ff6666', textAlign: 'center', margin: 0 }}>{error}</p>}

      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          style={{
            flex: 1,
            padding: '16px',
            background: '#444',
            color: '#fff',
            borderRadius: '12px',
            border: 'none',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            flex: 1,
            padding: '16px',
            background: '#000',
            color: '#fff',
            borderRadius: '12px',
            border: 'none',
          }}
        >
          {isSubmitting ? 'Creating...' : 'Create Gathering'}
        </button>
      </div>
    </form>
  );
};

export default EventForm;

// --- End of File ---
// Filepath: src/components/EventForm.tsx
// Version: v1.1.1
