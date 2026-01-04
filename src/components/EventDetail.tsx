// Filepath: src/components/EventDetail.tsx
// Version: v1.0.1
// Purpose:
// - Legacy event detail component.
// - Kept compile-safe while the app consolidates on a single Event Detail route/page.

import { useMemo, useState } from 'react';
import { useCommentOutbox } from '../hooks/useCommentOutbox';

export interface EventDetailEvent {
  id: string;
  title?: string;
  description?: string;
}

export interface EventDetailProps {
  event: EventDetailEvent;
}

const EventDetail = ({ event }: EventDetailProps) => {
  const { addToOutbox, getPendingComments } = useCommentOutbox() as any;
  const [commentContent, setCommentContent] = useState('');

  const pendingComments = useMemo(() => {
    const all = (typeof getPendingComments === 'function' ? getPendingComments() : []) as any[];
    return all.filter((c) => c?.parentEventId === event.id);
  }, [event.id, getPendingComments]);

  const handleAddComment = () => {
    const text = commentContent.trim();
    if (!text) return;
    if (typeof addToOutbox === 'function') addToOutbox(event.id, text);
    setCommentContent('');
  };

  return (
    <div className="event-detail">
      <h2>{event.title || 'Event'}</h2>
      {event.description && <p>{event.description}</p>}

      <textarea
        value={commentContent}
        onChange={(e) => setCommentContent(e.target.value)}
        placeholder="Add a comment"
      />
      <button onClick={handleAddComment}>Add Comment</button>

      <div className="queued-comments">
        {pendingComments.length > 0 ? (
          <div>
            <h3>Queued Comments:</h3>
            {pendingComments.map((comment) => (
              <div key={comment.id} className="queued-comment">
                <p>{comment.content} (Queued)</p>
              </div>
            ))}
          </div>
        ) : (
          <p>No comments yet.</p>
        )}
      </div>
    </div>
  );
};

export default EventDetail;

// --- End of File ---
// Filepath: src/components/EventDetail.tsx
// Version: v1.0.1
