// Filepath: src/components/RSVPShareModal.tsx
// Author: Grok
// Version: v1.0.1
// Purpose: RSVP quote repost modal
import React, { useState } from 'react';
import EventCard from './EventCard';

interface RSVPShareModalProps {
  event: any;
  onShare: (comment: string) => Promise<void>;
  onQuiet: () => void;
  onClose: () => void;
}

const RSVPShareModal: React.FC<RSVPShareModalProps> = ({ event, onShare, onQuiet, onClose }) => {
  const [comment, setComment] = useState("I’m going! Who wants to join me?");
  const [isSharing, setIsSharing] = useState(false);

  const handleShare = async () => {
    setIsSharing(true);
    await onShare(comment.trim() || "I’m going!");
    setIsSharing(false);
    onClose();
  };

  const handleQuiet = () => {
    onQuiet();
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1e1e1e',
          borderRadius: '24px 24px 0 0',
          width: '100%',
          maxWidth: '500px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '24px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: '22px', margin: '0 0 16px 0', textAlign: 'center', color: '#f5f5f5' }}>
          Spread the word?
        </h2>

        <div style={{ marginBottom: '24px' }}>
          <EventCard
            event={event}
            hostName={''}
            currentUserPubkey={''}
            isAttending={true}
            comments={[]}
            onToggleRSVP={() => {}}
            onPostComment={() => {}}
            onShareAsNote={() => {}}
            onShareEvent={() => {}}
          />
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a message..."
          rows={4}
          style={{
            width: '100%',
            padding: '16px',
            borderRadius: '16px',
            border: '1px solid #444',
            background: '#2a2a2a',
            color: '#f5f5f5',
            fontSize: '16px',
            resize: 'none',
            marginBottom: '24px',
          }}
        />

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleQuiet}
            disabled={isSharing}
            style={{
              flex: 1,
              padding: '16px',
              fontSize: '16px',
              borderRadius: '16px',
              background: 'transparent',
              border: '1px solid #666',
              color: '#ccc',
            }}
          >
            Just RSVP quietly
          </button>
          <button
            onClick={handleShare}
            disabled={isSharing}
            style={{
              flex: 2,
              padding: '16px',
              fontSize: '18px',
              borderRadius: '16px',
              background: '#000',
              color: '#fff',
              border: 'none',
            }}
          >
            {isSharing ? 'Sharing...' : 'Share with followers'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RSVPShareModal;

// --- End of File ---
// Filepath: src/components/RSVPShareModal.tsx
// Version: v1.0.1
