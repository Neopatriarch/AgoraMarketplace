// Filepath: src/LoginPage.tsx
// Author: Robert Kirkpatrick
// Version: v11.1.0
// Purpose: Local Nostr identity creation/import (authentication).
//
// ✅ AUTH FIX SUMMARY:
// - Nostr uses secp256k1 keys.
// - WebCrypto (crypto.subtle) does NOT support secp256k1, so prior attempts to derive pubkeys using P-256
//   were guaranteed to fail (and some browsers refuse exporting private keys entirely).
// - We now use the same robust helpers as App.tsx (src/utils/auth.ts):
//   * generateSecp256k1PrivateKey()
//   * encodeNsec() / decodeNsecToBytes()

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  decodeNsecToBytes,
  encodeNsec,
  generateSecp256k1PrivateKey,
  getPublicKeyHexFromPrivateKey,
} from './utils/auth';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();

  const [importKey, setImportKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const handleGenerateKey = async () => {
    setIsLoading(true);
    setError('');

    try {
      // Generate a valid secp256k1 private key and store it as canonical NIP-19 nsec.
      const sk = generateSecp256k1PrivateKey();
      const nsec = encodeNsec(sk);

      // Optional: also store pubkey for debugging / future UX (the app can always re-derive it).
      const pubkey = getPublicKeyHexFromPrivateKey(sk);

      localStorage.setItem('agora_privateKey', nsec);
      localStorage.setItem('agora_publicKey', pubkey);

      // Navigate to the main app.
      navigate('/');
    } catch (e) {
      console.error(e);
      setError('Failed to generate a new identity. Your browser may not be supported.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Accept either:
      // - nsec1... (recommended)
      // - 64-char hex private key (legacy / convenience)
      // Then normalize to canonical nsec for storage.
      const sk = decodeNsecToBytes(importKey);
      const nsec = encodeNsec(sk);
      const pubkey = getPublicKeyHexFromPrivateKey(sk);

      localStorage.setItem('agora_privateKey', nsec);
      localStorage.setItem('agora_publicKey', pubkey);

      navigate('/');
    } catch (e) {
      console.error(e);
      setError('That key does not look valid. Please paste a valid nsec (or 64-character hex).');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', padding: '20px' }}>
      <h2>Welcome to Agora Marketplace</h2>
      <p style={{ textAlign: 'center', color: '#555', marginBottom: '30px' }}>
        Create a new identity or import your existing Nostr account to get started.
      </p>

      <div style={{ width: '100%', maxWidth: '400px' }}>
        <button
          onClick={handleGenerateKey}
          disabled={isLoading}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: '14px',
            border: 'none',
            background: '#222',
            color: 'white',
            fontSize: '16px',
            marginBottom: '20px',
            cursor: 'pointer',
            opacity: isLoading ? 0.7 : 1,
          }}
        >
          {isLoading ? 'Creating...' : 'Create a New Identity'}
        </button>

        <form onSubmit={handleImportKey}>
          <input
            type="password"
            placeholder="Paste your nsec (or 64-hex key)"
            value={importKey}
            onChange={(e) => setImportKey(e.target.value)}
            disabled={isLoading}
            style={{
              width: '100%',
              padding: '14px',
              fontSize: '15px',
              borderRadius: '14px',
              border: '1px solid #ccc',
              marginBottom: '10px',
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !importKey.trim()}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '14px',
              border: 'none',
              background: '#0b5',
              color: 'white',
              fontSize: '16px',
              cursor: 'pointer',
              opacity: isLoading || !importKey.trim() ? 0.7 : 1,
            }}
          >
            {isLoading ? 'Importing...' : 'Import Existing Key'}
          </button>
        </form>
      </div>

      {error && <p style={{ color: 'red', marginTop: '20px', textAlign: 'center' }}>{error}</p>}
    </div>
  );
};

export default LoginPage;

// --- End of File ---
// Filepath: src/LoginPage.tsx
// Version: v11.1.0
