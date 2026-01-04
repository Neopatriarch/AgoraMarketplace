// Filepath: src/HomePage.tsx
// Author: Robert Kirkpatrick
// Updated by: ChatGPT
// Version: v1.8.5
// Purpose:
// - Add BOTH refresh methods:
//   1) Top-bar Refresh button (always visible)
//   2) Pull-to-refresh gesture (mobile) when scrolled to top
// - Keep existing Create/Search/Profile/Zaps wiring and share handlers

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EventCard from './components/EventCard';
import RSVPShareModal from './components/RSVPShareModal';
import EventForm from './components/EventForm';
import { useAgoraData } from './hooks/useAgoraData';

const PULL_THRESHOLD_PX = 70;
const MAX_PULL_PX = 120;

const HomePage: React.FC<{ currentUserPubkey: string }> = ({ currentUserPubkey }) => {
  const navigate = useNavigate();

  const agoraData = useAgoraData(currentUserPubkey);
  const {
    events = [],
    hostProfiles,
    comments,
    isLoading,
    isLoadingMore,
    hasMoreEvents,
    error,
    toastMessage,
    clearError,
    handleLoadMore,
    handleCreateEvent,
    handlePostComment,
    refresh,
    showToast,

    // Share handlers
    handleShareAsNote,
    handleShareEvent,
  } = agoraData as any;

  const [shareModalEvent, setShareModalEvent] = useState<any | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loadingTimeout, setLoadingTimeout] = useState(true);

  // Pull-to-refresh UI state
  const [isPulling, setIsPulling] = useState(false);
  const [pullPx, setPullPx] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartYRef = useRef<number | null>(null);
  const pullingEligibleRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setLoadingTimeout(false), 8000);
    return () => clearTimeout(timer);
  }, []);

  const closeShareModal = () => setShareModalEvent(null);

  const handleQuoteRepostFromModal = async (_comment: string) => {
    closeShareModal();
    showToast('Sharing coming soon!');
  };

  const handleEventCreated = () => {
    setShowCreateForm(false);
    // Optional: refresh right after creation so it appears immediately
    // refresh();
  };

  useEffect(() => {
    const handleScroll = () => {
      if (window.innerHeight + document.documentElement.scrollTop >= document.documentElement.offsetHeight - 500) {
        if (!isLoadingMore && hasMoreEvents) handleLoadMore();
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isLoadingMore, hasMoreEvents, handleLoadMore]);

  const safeCreateEvent = async (mockEvent: any) => {
    await handleCreateEvent(mockEvent);
  };

  const isActuallyLoading = isLoading && loadingTimeout;

  // ------------------------------
  // Pull-to-refresh handlers
  // ------------------------------
  const beginRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const onTouchStart: React.TouchEventHandler<HTMLDivElement> = (e) => {
    if (isRefreshing) return;

    // Only allow pull-to-refresh if the page is at the very top.
    const atTop = window.scrollY <= 0;
    if (!atTop) {
      touchStartYRef.current = null;
      pullingEligibleRef.current = false;
      return;
    }

    touchStartYRef.current = e.touches[0]?.clientY ?? null;
    pullingEligibleRef.current = true;
    setIsPulling(false);
    setPullPx(0);
  };

  const onTouchMove: React.TouchEventHandler<HTMLDivElement> = (e) => {
    if (!pullingEligibleRef.current || isRefreshing) return;
    if (touchStartYRef.current == null) return;

    const currentY = e.touches[0]?.clientY ?? 0;
    const delta = currentY - touchStartYRef.current;

    if (delta <= 0) {
      // user is scrolling up (normal), ignore
      setIsPulling(false);
      setPullPx(0);
      return;
    }

    // We’re pulling down
    const clamped = Math.min(delta, MAX_PULL_PX);
    setIsPulling(true);
    setPullPx(clamped);

    // Prevent the browser rubber-band scroll from feeling glitchy
    // ONLY when we are at top and pulling.
    e.preventDefault?.();
  };

  const onTouchEnd: React.TouchEventHandler<HTMLDivElement> = async () => {
    if (!pullingEligibleRef.current) return;

    const shouldRefresh = pullPx >= PULL_THRESHOLD_PX;

    // Reset gesture state immediately (feels snappy)
    touchStartYRef.current = null;
    pullingEligibleRef.current = false;
    setIsPulling(false);
    setPullPx(0);

    if (shouldRefresh) {
      await beginRefresh();
      showToast('Refreshed');
    }
  };

  if (error) {
    return (
      <div style={{ background: '#f5f0e8', minHeight: '100vh', padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#ff6666' }}>{error}</p>
        <button
          onClick={clearError}
          style={{ padding: '12px 24px', background: '#000', color: '#fff', borderRadius: '12px', border: 'none' }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      style={{ background: '#f5f0e8', minHeight: '100vh' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator (mobile) */}
      {(isPulling || isRefreshing) && (
        <div
          style={{
            position: 'fixed',
            top: 60, // just under top bar
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 2501,
          }}
        >
          <div
            style={{
              background: '#fffaf2',
              border: '1px solid #e8dccb',
              borderRadius: '14px',
              padding: '8px 12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              color: '#333',
              fontSize: '14px',
              opacity: 0.95,
              transform: `translateY(${Math.min(pullPx, 40) * 0.5}px)`,
              transition: isRefreshing ? 'transform 120ms ease' : 'none',
            }}
          >
            {isRefreshing ? 'Refreshing…' : pullPx >= PULL_THRESHOLD_PX ? 'Release to refresh' : 'Pull to refresh'}
          </div>
        </div>
      )}

      {/* Top Bar */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '60px',
          background: '#fffaf2',
          borderBottom: '1px solid #e8dccb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          zIndex: 2000,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}
      >
        <button style={topBarButtonStyle(true)}>Home</button>

        {/* NEW: Refresh button */}
        <button
          style={topBarButtonStyle()}
          onClick={async () => {
            await beginRefresh();
            showToast('Refreshed');
          }}
          disabled={isRefreshing}
          title="Refresh"
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>

        <button style={topBarButtonStyle()} onClick={() => setShowCreateForm(true)}>
          Create
        </button>

        <button style={topBarButtonStyle()} onClick={() => showToast('Search coming soon!')}>
          Search
        </button>

        <button style={topBarButtonStyle()} onClick={() => navigate('/profile')}>
          Profile
        </button>

        <button style={topBarButtonStyle()} onClick={() => showToast('Zaps coming soon! ⚡')}>
          Zaps
        </button>
      </div>

      <div style={{ padding: '80px 20px 100px', maxWidth: '600px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', margin: '0 0 32px 0', textAlign: 'center', color: '#333' }}>Agora Marketplace</h1>

        {toastMessage && (
          <div
            style={{
              position: 'fixed',
              top: '140px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#333',
              color: '#fff',
              padding: '16px 24px',
              borderRadius: '12px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              zIndex: 3000,
            }}
          >
            {toastMessage}
          </div>
        )}

        {isActuallyLoading ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#777' }}>
            <p style={{ fontSize: '20px' }}>Loading gatherings...</p>
            {/* This is the older “loading state” refresh (kept) */}
            <button
              onClick={async () => {
                await beginRefresh();
                showToast('Refreshed');
              }}
              style={{
                marginTop: '20px',
                padding: '12px 24px',
                background: '#ff6b35',
                color: '#fff',
                borderRadius: '12px',
                border: 'none',
              }}
            >
              Refresh now
            </button>
          </div>
        ) : events.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#777' }}>
            <p style={{ fontSize: '20px' }}>No gatherings yet.</p>
            <p>Be the first to create one!</p>
            <button
              onClick={() => setShowCreateForm(true)}
              style={{
                marginTop: '20px',
                padding: '12px 24px',
                background: '#ff6b35',
                color: '#fff',
                borderRadius: '12px',
                border: 'none',
              }}
            >
              Create gathering
            </button>
          </div>
        ) : (
          events.map((event: any) => {
            const hostProfile = hostProfiles?.[event.pubkey] || {};
            const eventComments = comments?.[event.id] || [];
            return (
              <EventCard
                key={event.id}
                event={event.raw || event}
                hostName={hostProfile.name || hostProfile.display_name || 'Anonymous'}
                currentUserPubkey={currentUserPubkey}
                startTime={undefined}
                isAttending={false}
                comments={eventComments}
                onToggleRSVP={() => showToast('RSVP coming soon!')}
                onPostComment={handlePostComment}
                onShareAsNote={(ev: any) => handleShareAsNote(ev)}
                onShareEvent={(ev: any) => handleShareEvent(ev)}
              />
            );
          })
        )}

        {isLoadingMore && <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>Loading more...</div>}
      </div>

      {/* Create Modal */}
      {showCreateForm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2500,
          }}
          onClick={() => setShowCreateForm(false)}
        >
          <div
            style={{
              background: '#fffaf2',
              borderRadius: '24px',
              width: '90%',
              maxWidth: '500px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <EventForm onSubmit={safeCreateEvent} onCancel={() => setShowCreateForm(false)} onSuccess={handleEventCreated} />
          </div>
        </div>
      )}

      {shareModalEvent && (
        <RSVPShareModal
          event={shareModalEvent}
          onShare={handleQuoteRepostFromModal}
          onQuiet={closeShareModal}
          onClose={closeShareModal}
        />
      )}
    </div>
  );
};

const topBarButtonStyle = (active = false) => ({
  background: 'none',
  border: 'none',
  fontSize: '16px',
  color: active ? '#ff6b35' : '#555',
  fontWeight: active ? 'bold' : 'normal',
  padding: '8px 12px',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: '4px',
});

export default HomePage;

// --- End of File ---
// Filepath: src/HomePage.tsx
// Version: v1.8.5
