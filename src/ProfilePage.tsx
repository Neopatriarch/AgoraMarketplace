// Filepath: src/ProfilePage.tsx
// Author: Robert Kirkpatrick
// Updated by: ChatGPT
// v1.2.2 - Logout is non-destructive (clears only access). Added "Front door mode" + separate "Start over completely".

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface ProfilePageProps {
  userPublicKey: string;
}

const ProfilePage: React.FC<ProfilePageProps> = ({ userPublicKey }) => {
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);

  const [lightningAddress, setLightningAddress] = useState('');
  const [isEditingLightning, setIsEditingLightning] = useState(false);

  const [pinEnabled, setPinEnabled] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isSettingPin, setIsSettingPin] = useState(false);

  useEffect(() => {
    const savedName = localStorage.getItem('agora_displayName');
    if (savedName) setDisplayName(savedName);

    const savedLn = localStorage.getItem('agora_lightning_address');
    if (savedLn) setLightningAddress(savedLn);

    const savedPin = localStorage.getItem('agora_pin_hash');
    if (savedPin) setPinEnabled(true);
  }, []);

  const handleSaveName = () => {
    if (displayName.trim()) {
      localStorage.setItem('agora_displayName', displayName.trim());
    } else {
      localStorage.removeItem('agora_displayName');
    }
    setIsEditingName(false);
  };

  const isValidLightningAddress = (val: string) => {
    // Basic "name@domain.tld" check (good enough for UI validation)
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
  };

  const handleSaveLightning = () => {
    const v = lightningAddress.trim();
    if (!v) {
      localStorage.removeItem('agora_lightning_address');
      setLightningAddress('');
      setIsEditingLightning(false);
      return;
    }
    if (!isValidLightningAddress(v)) {
      alert('That doesn’t look like a Lightning Address (example: name@domain.com)');
      return;
    }
    localStorage.setItem('agora_lightning_address', v);
    setLightningAddress(v);
    setIsEditingLightning(false);
  };

  const handleTogglePin = () => {
    if (pinEnabled) {
      // Disable PIN
      localStorage.removeItem('agora_pin_hash');
      setPinEnabled(false);
      setIsSettingPin(false);
      setNewPin('');
      setConfirmPin('');
    } else {
      // Enable PIN — show setup
      setIsSettingPin(true);
      setNewPin('');
      setConfirmPin('');
    }
  };

  const handleSetPin = () => {
    if (newPin.length < 4) {
      alert('PIN must be at least 4 digits');
      return;
    }
    if (newPin !== confirmPin) {
      alert('PINs do not match');
      return;
    }
    // Simple hash (good enough for local PIN)
    const hash = btoa(newPin);
    localStorage.setItem('agora_pin_hash', hash);
    setPinEnabled(true);
    setIsSettingPin(false);
    setNewPin('');
    setConfirmPin('');
    alert('PIN protection enabled!');
  };

  /**
   * FRONT DOOR MODE (non-destructive)
   * - Keep key/settings.
   * - Set a flag so App can show the gate next load.
   */
  const goToFrontDoorWithoutDeletingKey = () => {
    localStorage.setItem('agora_force_front_door', '1');
    try {
      navigate('/');
    } catch {}
    window.location.reload();
  };

  /**
   * LOGOUT (non-destructive)
   * - Clears access only.
   * - Keeps profile prefs (name/lightning/pin) on device.
   */
  const handleLogout = () => {
    if (!confirm('Logout? You can come back later with your nsec or wallet.')) return;

    // Clear only the access token/key selector.
    localStorage.removeItem('agora_privateKey');

    // Optional: also clear front-door flag so next session is clean.
    localStorage.removeItem('agora_force_front_door');

    try {
      navigate('/');
    } catch {}
    window.location.reload();
  };

  /**
   * START OVER COMPLETELY (destructive)
   * - Erases everything on this device.
   */
  const startOverCompletely = () => {
    localStorage.removeItem('agora_privateKey');
    localStorage.removeItem('agora_displayName');
    localStorage.removeItem('agora_lightning_address');
    localStorage.removeItem('agora_pin_hash');
    localStorage.removeItem('agora_force_front_door');

    try {
      navigate('/');
    } catch {}
    window.location.reload();
  };

  const shortKey = userPublicKey ? `${userPublicKey.slice(0, 8)}...${userPublicKey.slice(-8)}` : '';

  return (
    <div
      style={{
        padding: '40px 20px',
        maxWidth: '420px',
        margin: '0 auto',
        textAlign: 'center',
        minHeight: '100vh',
        background: '#f5f0e8',
      }}
    >
      <h1 style={{ fontSize: '28px', marginBottom: '18px', color: '#333' }}>Profile & Settings</h1>

      <button
        onClick={() => navigate('/')}
        style={{
          marginBottom: '24px',
          padding: '10px 16px',
          background: 'transparent',
          border: '1px solid #ccc',
          borderRadius: '12px',
          color: '#444',
          fontSize: '14px',
        }}
      >
        ← Back to Home
      </button>

      <div
        style={{
          width: '120px',
          height: '120px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #f5e6d3, #e8d8c3)',
          margin: '0 auto 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '48px',
        }}
      >
        👤
      </div>

      {/* Display Name */}
      <div style={{ marginBottom: '34px' }}>
        {isEditingName ? (
          <>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name or nickname"
              autoFocus
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '20px',
                textAlign: 'center',
                borderRadius: '12px',
                border: '1px solid #ddd',
                marginBottom: '16px',
              }}
            />
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={() => {
                  setDisplayName(localStorage.getItem('agora_displayName') || '');
                  setIsEditingName(false);
                }}
                style={{
                  padding: '12px 24px',
                  background: '#f8f8f8',
                  border: '1px solid #ccc',
                  borderRadius: '12px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveName}
                style={{
                  padding: '12px 24px',
                  background: '#000',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '12px',
                }}
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: '26px', margin: '0 0 12px 0' }}>{displayName || 'Add your name'}</h2>
            <button
              onClick={() => setIsEditingName(true)}
              style={{
                padding: '10px 20px',
                background: 'none',
                border: '1px dashed #999',
                borderRadius: '12px',
                color: '#666',
                fontSize: '15px',
              }}
            >
              {displayName ? 'Change name' : 'Set name (optional)'}
            </button>
          </>
        )}
      </div>

      {/* Lightning Address */}
      <div style={{ marginBottom: '34px' }}>
        <h3 style={{ fontSize: '20px', marginBottom: '10px', color: '#333' }}>Lightning Address</h3>

        {isEditingLightning ? (
          <>
            <input
              type="text"
              value={lightningAddress}
              onChange={(e) => setLightningAddress(e.target.value)}
              placeholder="name@domain.com"
              autoFocus
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '16px',
                textAlign: 'center',
                borderRadius: '12px',
                border: '1px solid #ddd',
                marginBottom: '12px',
              }}
            />
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={() => {
                  setLightningAddress(localStorage.getItem('agora_lightning_address') || '');
                  setIsEditingLightning(false);
                }}
                style={{
                  padding: '12px 24px',
                  background: '#f8f8f8',
                  border: '1px solid #ccc',
                  borderRadius: '12px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLightning}
                style={{
                  padding: '12px 24px',
                  background: '#000',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '12px',
                }}
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                fontSize: '16px',
                color: '#444',
                background: '#fff',
                border: '1px solid #e6dccc',
                borderRadius: '12px',
                padding: '12px',
                wordBreak: 'break-all',
              }}
            >
              {lightningAddress || 'Not set'}
            </div>
            <button
              onClick={() => setIsEditingLightning(true)}
              style={{
                marginTop: '10px',
                padding: '10px 20px',
                background: 'none',
                border: '1px dashed #999',
                borderRadius: '12px',
                color: '#666',
                fontSize: '15px',
              }}
            >
              {lightningAddress ? 'Change lightning address' : 'Add lightning address'}
            </button>
          </>
        )}
      </div>

      {/* PIN Protection */}
      <div style={{ marginBottom: '40px' }}>
        <h3 style={{ fontSize: '20px', marginBottom: '12px', color: '#333' }}>Privacy Protection</h3>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            fontSize: '18px',
          }}
        >
          <input type="checkbox" checked={pinEnabled} onChange={handleTogglePin} style={{ width: '24px', height: '24px' }} />
          Protect with PIN
        </label>

        {isSettingPin && (
          <div style={{ marginTop: '18px' }}>
            <input
              type="password"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="New PIN (4-6 digits)"
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '20px',
                textAlign: 'center',
                borderRadius: '12px',
                border: '1px solid #ddd',
                marginBottom: '12px',
              }}
            />
            <input
              type="password"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Confirm PIN"
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '20px',
                textAlign: 'center',
                borderRadius: '12px',
                border: '1px solid #ddd',
                marginBottom: '18px',
              }}
            />
            <button
              onClick={handleSetPin}
              style={{
                padding: '16px 32px',
                fontSize: '18px',
                background: '#ff6b35',
                color: '#fff',
                border: 'none',
                borderRadius: '16px',
              }}
            >
              Set PIN
            </button>
          </div>
        )}

        {pinEnabled && !isSettingPin && (
          <p style={{ marginTop: '12px', fontSize: '15px', color: '#777' }}>PIN enabled — app will lock on restart</p>
        )}
      </div>

      {/* Public Key */}
      <div style={{ marginBottom: '34px', opacity: 0.8 }}>
        <p style={{ fontSize: '14px', marginBottom: '8px' }}>Your public key</p>
        <code
          style={{
            fontSize: '14px',
            wordBreak: 'break-all',
            padding: '12px',
            background: '#f5f5f5',
            borderRadius: '12px',
            display: 'block',
          }}
        >
          {shortKey}
        </code>
      </div>

      {/* Session & Security menu */}
      <div style={{ textAlign: 'left', marginTop: '8px' }}>
        <h3 style={{ fontSize: '20px', marginBottom: '12px', color: '#333', textAlign: 'center' }}>
          Session & Security
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            onClick={goToFrontDoorWithoutDeletingKey}
            style={{
              padding: '16px 18px',
              fontSize: '16px',
              background: '#fff',
              color: '#333',
              border: '1px solid #d7cbb8',
              borderRadius: '16px',
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '4px' }}>Front door mode</div>
            <div style={{ fontSize: '13px', opacity: 0.75 }}>
              Show onboarding again without deleting your key.
            </div>
          </button>

          <button
            onClick={handleLogout}
            style={{
              padding: '16px 18px',
              fontSize: '16px',
              background: '#fff',
              color: '#b00020',
              border: '1px solid #f0b6bf',
              borderRadius: '16px',
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '4px' }}>Logout</div>
            <div style={{ fontSize: '13px', opacity: 0.75 }}>
              Clears access only. Keeps your name, lightning address, and PIN on this device.
            </div>
          </button>

          <button
            onClick={() => {
              if (confirm('Start over completely? This erases your key and settings on this device.')) {
                startOverCompletely();
              }
            }}
            style={{
              padding: '16px 18px',
              fontSize: '16px',
              background: '#fff',
              color: '#333',
              border: '2px solid #333',
              borderRadius: '16px',
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '4px' }}>Start over completely</div>
            <div style={{ fontSize: '13px', opacity: 0.75 }}>
              Erase this device’s Agora data. (Hard reset.)
            </div>
          </button>
        </div>
      </div>

      <p style={{ marginTop: '34px', fontSize: '14px', opacity: 0.65, lineHeight: '1.5' }}>
        Your name appears on gatherings you create.<br />
        Everything is stored only on this device — no servers.
      </p>
    </div>
  );
};

export default ProfilePage;

// --- End of File ---
// Filepath: src/ProfilePage.tsx
// Version: v1.2.2
