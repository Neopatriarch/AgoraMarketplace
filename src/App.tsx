// Filepath: src/App.tsx
// Version: v1.9.1
// Purpose: Start WebSocket only after user action and keep auth gate stable.
//
// IMPORTANT FIX:
// - Previously, WebSockets could be created multiple times (nostr.ts auto-connected on import).
// - This version:
//   1) Calls connectToWebSocket() ONLY after user clicks "Get Started" (or already has a key).
//   2) Uses onWebSocketState() to set isWebSocketReady reliably.
//   3) Avoids multiple WS connection loops in React dev.

import React, { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './HomePage';
import ProfilePage from './ProfilePage';
import * as nostrTools from 'nostr-tools';
import { connectToWebSocket, onWebSocketState } from './utils/nostr';

const App: React.FC = () => {
  const [keyInput, setKeyInput] = useState('');
  const [isSettingUp, setIsSettingUp] = useState(false);

  const [walletPubkey, setWalletPubkey] = useState('');
  const [showProOptions, setShowProOptions] = useState(false);

  const [isWebSocketReady, setIsWebSocketReady] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [milestone, setMilestone] = useState('Waiting for user to click "Get Started"...');

  const [isStarted, setIsStarted] = useState(false);
  const [keyGenerated, setKeyGenerated] = useState(false);

  const storedKey = localStorage.getItem('agora_privateKey');
  const forceFrontDoor = localStorage.getItem('agora_force_front_door') === '1';

  // Derive pubkey from stored nsec (if present).
  const derivedPubkey = useMemo(() => {
    if (!storedKey || storedKey === 'extension_used') return '';
    try {
      const decoded = (nostrTools as any).nip19.decode(storedKey);
      if (decoded.type !== 'nsec') return '';
      const skBytes: Uint8Array = decoded.data;
      const pk = (nostrTools as any).getPublicKey(skBytes);
      return typeof pk === 'string' ? pk : '';
    } catch {
      return '';
    }
  }, [storedKey]);

  // If extension wallet is used, fetch pubkey.
  useEffect(() => {
    if (storedKey !== 'extension_used') return;
    if (!(window as any).nostr?.getPublicKey) return;

    (async () => {
      try {
        const pk = await (window as any).nostr.getPublicKey();
        if (typeof pk === 'string') setWalletPubkey(pk);
      } catch {}
    })();
  }, [storedKey]);

  // ✅ NEW: Subscribe once to WS state changes
  useEffect(() => {
    onWebSocketState((connected) => {
      setIsWebSocketReady(connected);
    });
  }, []);

  // ✅ NEW: Start WS only after user clicks Get Started OR if a key already exists
  useEffect(() => {
    const hasKeyAlready =
      Boolean(storedKey) && (storedKey === 'extension_used' || storedKey?.startsWith('nsec'));

    // If user hasn't started AND no key exists, do nothing.
    if (!isStarted && !hasKeyAlready) return;

    // We consider "keyGenerated" true as soon as we have a stored key.
    if (hasKeyAlready) setKeyGenerated(true);

    setMilestone('Connecting to relays...');
    connectToWebSocket();
  }, [isStarted, storedKey]);

  // ✅ STABLE access gate:
  // Access requires:
  // - key OR wallet pubkey
  // - websocket connected
  // - not forcing front door
  const hasAccess =
    (Boolean(derivedPubkey) || (storedKey === 'extension_used' && Boolean(walletPubkey))) &&
    keyGenerated &&
    isWebSocketReady &&
    !forceFrontDoor;

  const currentUserPubkey = derivedPubkey || walletPubkey || '';

  const handleGetStarted = () => {
    setIsStarted(true);
    setIsSettingUp(true);
    setSetupError('');
    setMilestone('Generating your local identity...');

    try {
      // Keep your existing key generation mechanism here if you already applied the auth fix.
      // If not, this is where your earlier auth patch should be used.
      const generateSecretKey = (nostrTools as any).generateSecretKey;
      if (!generateSecretKey) throw new Error('generateSecretKey missing');

      const sk = generateSecretKey();
      const nsec = (nostrTools as any).nip19.nsecEncode(sk);

      localStorage.setItem('agora_privateKey', nsec);
      localStorage.removeItem('agora_force_front_door');

      setKeyGenerated(true);
      setMilestone('Key created. Connecting to relays...');
      window.location.reload();
    } catch (err) {
      console.warn('Setup failed:', err);
      setSetupError('Setup failed. Please try again.');
      setIsSettingUp(false);
      setMilestone('Key generation failed.');
    }
  };

  const handleUseMyKey = (e: React.FormEvent) => {
    e.preventDefault();
    const input = keyInput.trim();
    if (!input) return;

    try {
      const decoded = (nostrTools as any).nip19.decode(input);
      if (decoded.type !== 'nsec') throw new Error('not nsec');

      localStorage.setItem('agora_privateKey', input);
      localStorage.removeItem('agora_force_front_door');
      setKeyGenerated(true);
      setMilestone('Key imported. Connecting to relays...');
      window.location.reload();
    } catch {
      alert('Invalid key');
    }
  };

  const handleConnectWallet = async () => {
    if (!(window as any).nostr?.getPublicKey) {
      alert('No wallet found');
      return;
    }
    try {
      await (window as any).nostr.getPublicKey();
      localStorage.setItem('agora_privateKey', 'extension_used');
      localStorage.removeItem('agora_force_front_door');
      setKeyGenerated(true);
      setMilestone('Wallet connected. Connecting to relays...');
      window.location.reload();
    } catch {
      alert('Wallet connection failed');
    }
  };

  if (!hasAccess) {
    return (
      <div style={{ padding: 20, maxWidth: 480, margin: '0 auto' }}>
        <h2>Agora Marketplace</h2>

        <p style={{ color: '#555' }}>{milestone}</p>
        {setupError && <p style={{ color: 'red' }}>{setupError}</p>}
        {!isWebSocketReady && (isStarted || storedKey) && (
          <p style={{ color: '#b36b00' }}>
            Relays are unstable right now (connections may open/close). The app will proceed as soon as one stays connected.
          </p>
        )}

        <button
          onClick={handleGetStarted}
          disabled={isSettingUp}
          style={{ width: '100%', padding: 14, borderRadius: 14, marginBottom: 12 }}
        >
          {isSettingUp ? 'Setting up...' : 'Get Started'}
        </button>

        <button
          onClick={() => setShowProOptions((v) => !v)}
          style={{ width: '100%', padding: 14, borderRadius: 14, marginBottom: 12 }}
        >
          {showProOptions ? 'Hide Advanced Options' : 'Advanced Options'}
        </button>

        {showProOptions && (
          <div style={{ border: '1px solid #ddd', borderRadius: 14, padding: 12 }}>
            <button
              onClick={handleConnectWallet}
              style={{ width: '100%', padding: 14, borderRadius: 14, marginBottom: 12 }}
            >
              Connect wallet
            </button>

            <form onSubmit={handleUseMyKey}>
              <input
                type="password"
                placeholder="Paste your nsec"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '14px',
                  fontSize: '15px',
                  borderRadius: '14px',
                  border: '1px solid #ccc',
                  marginBottom: '10px',
                }}
              />
              <button type="submit" style={{ width: '100%', padding: 14, borderRadius: 14 }}>
                Use my key
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage currentUserPubkey={currentUserPubkey} />} />
        <Route path="/profile" element={<ProfilePage userPublicKey={currentUserPubkey} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;

// --- End of File ---
// Filepath: src/App.tsx
// Version: v1.9.1
