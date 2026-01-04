// Filepath: src/components/OnboardingFlow.tsx
// Author: Robert Kirkpatrick
// Updated by: Grok
// Version: v1.6.2
// Purpose: Onboarding flow (create/import, location, name). Type-safe handlers.

import React, { useState } from 'react';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';

const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

const hexToBytes = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
};

interface OnboardingFlowProps {
  onComplete: (publicKey: string) => void;
}

const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete }) => {
  const [step, setStep] = useState<'welcome' | 'create' | 'import' | 'location' | 'name'>('welcome');
  const [locationChoiceMade, setLocationChoiceMade] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [importKey, setImportKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [publicKey, setPublicKey] = useState<string | null>(null);

  const proceedToName = (pk: string) => {
    setPublicKey(pk);
    setStep('name');
  };

  const handleGetLocation = () => {
    setIsGettingLocation(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      () => {
        localStorage.setItem('agora_locationPermission', 'granted');
        setIsGettingLocation(false);
        setLocationChoiceMade(true);
      },
      (error) => {
        console.error('Geolocation error:', error);
        setLocationError('Location access denied. You can enable it later.');
        localStorage.setItem('agora_locationPermission', 'denied');
        setIsGettingLocation(false);
        setLocationChoiceMade(true);
      }
    );
  };

  const handleSkipLocation = () => {
    setLocationError('Location skipped — you can change this anytime.');
    localStorage.setItem('agora_locationPermission', 'denied');
    setLocationChoiceMade(true);
  };

  const handleCreateAccount = () => {
    const skBytes = generateSecretKey();
    const skHex = bytesToHex(skBytes);
    const pkHex = getPublicKey(skBytes);

    localStorage.setItem('agora_privateKey', skHex);
    localStorage.setItem('agora_publicKey', pkHex);

    proceedToName(pkHex);
  };

  const handleImportAccount = () => {
    if (!importKey.trim()) {
      alert('Please enter your private key.');
      return;
    }

    try {
      let skHex: string;

      if (importKey.startsWith('nsec')) {
        const decoded = nip19.decode(importKey);
        if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
        skHex = bytesToHex(decoded.data as Uint8Array);
      } else {
        const cleaned = importKey.trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(cleaned)) {
          throw new Error('Invalid hex private key');
        }
        skHex = cleaned;
      }

      const pkHex = getPublicKey(hexToBytes(skHex));

      localStorage.setItem('agora_privateKey', skHex);
      localStorage.setItem('agora_publicKey', pkHex);

      proceedToName(pkHex);
    } catch (err) {
      alert('Invalid private key.');
    }
  };

  const finishOnboarding = () => {
    if (displayName.trim()) {
      localStorage.setItem('agora_displayName', displayName.trim());
    }
    if (publicKey) {
      onComplete(publicKey);
    }
  };

  if (step === 'welcome') {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', maxWidth: '420px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', marginBottom: '16px' }}>Welcome to Agora Marketplace</h1>
        <p style={{ fontSize: '16px', marginBottom: '40px', opacity: 0.8 }}>
          Discover and create real-world gatherings — no jargon, just people.
        </p>
        <button onClick={() => setStep('create')} style={{ width: '100%', padding: '16px', fontSize: '18px', marginBottom: '12px' }}>
          Create a New Account
        </button>
        <button onClick={() => setStep('import')} style={{ width: '100%', padding: '16px', fontSize: '18px' }}>
          I Already Have a Key
        </button>
      </div>
    );
  }

  if (step === 'create' || step === 'import') {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', maxWidth: '420px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '24px' }}>
          {step === 'create' ? 'Setting things up…' : 'Welcome back'}
        </h2>

        {step === 'create' && (
          <>
            <p style={{ marginBottom: '32px', opacity: 0.9 }}>
              Allow location to see nearby events (optional).
            </p>
            {isGettingLocation && <p>Getting location…</p>}
            {locationError && <p style={{ color: '#e67e22' }}>{locationError}</p>}
            <div style={{ margin: '32px 0' }}>
              <button onClick={handleGetLocation} disabled={locationChoiceMade} style={{ width: '100%', padding: '14px', marginBottom: '12px' }}>
                Allow Location
              </button>
              <button onClick={handleSkipLocation} disabled={locationChoiceMade} style={{ width: '100%', padding: '14px' }}>
                Skip
              </button>
            </div>
          </>
        )}

        {step === 'import' && (
          <input
            type="password"
            placeholder="Paste nsec or hex key"
            value={importKey}
            onChange={(e) => setImportKey(e.target.value)}
            style={{ width: '100%', padding: '14px', fontSize: '16px', marginBottom: '32px' }}
            autoFocus
          />
        )}

        {(() => {
          const continueHandler =
            step === 'create'
              ? (locationChoiceMade ? handleCreateAccount : undefined)
              : handleImportAccount;

          return (
            <button
              onClick={continueHandler}
              disabled={step === 'create' ? !locationChoiceMade : !importKey.trim()}
              style={{
                width: '100%',
                padding: '18px',
                fontSize: '18px',
                background: '#000',
                color: '#fff',
                border: 'none',
                borderRadius: '12px',
              }}
            >
              Continue
            </button>
          );
        })()}
      </div>
    );
  }

  if (step === 'name') {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', maxWidth: '420px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '24px' }}>What should we call you?</h2>
        <p style={{ fontSize: '16px', marginBottom: '32px', opacity: 0.8 }}>
          Nickname, stage name, or real name — whatever feels right.
        </p>
        <input
          type="text"
          placeholder="Alex, DJ Spark, The Baker..."
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          style={{
            width: '100%',
            padding: '16px',
            fontSize: '18px',
            textAlign: 'center',
            borderRadius: '12px',
            border: '1px solid #ddd',
            marginBottom: '32px',
          }}
          autoFocus
        />
        <button
          onClick={finishOnboarding}
          style={{
            width: '100%',
            padding: '18px',
            fontSize: '18px',
            background: '#000',
            color: '#fff',
            border: 'none',
            borderRadius: '12px',
            marginBottom: '16px',
          }}
        >
          Enter Agora
        </button>
        <button
          onClick={finishOnboarding}
          style={{ background: 'none', border: 'none', color: '#666', fontSize: '16px' }}
        >
          Skip for now
        </button>
      </div>
    );
  }

  return null;
};

export default OnboardingFlow;

// --- End of File ---
// Filepath: src/components/OnboardingFlow.tsx
// Version: v1.6.2
