// Filepath: src/utils/auth.ts
// Version: v1.1.0
// Purpose: Robust, dependency-light Nostr key handling for Agora Marketplace.
// Notes:
// - Nostr uses secp256k1 keys (NOT P-256).
// - WebCrypto (crypto.subtle) does NOT support secp256k1, so we MUST NOT use it for key derivation.
// - We generate private keys with crypto.getRandomValues and validate against secp256k1 curve order.
// - We prefer nostr-tools' nip19 helpers when available, but include a small bech32 fallback
//   so authentication does not break if nip19 exports change in the future.
//
// Added in v1.1.0:
// - Local key storage helpers (save/get/clear) used by src/utils/nostr.ts and hooks/useAgoraData.ts.

import * as nostrTools from 'nostr-tools';

/** secp256k1 curve order (n) as BigInt.
 *  Source: SEC 2: Recommended Elliptic Curve Domain Parameters.
 *  n = FFFFFFFF FFFFFFFF FFFFFFFF FFFFFFFE BAAEDCE6 AF48A03B BFD25E8C D0364141
 */
const SECP256K1_N =
  BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

// Storage key for private key (prefer nsec for UX)
const LS_KEY_NSEC = 'agora_nsec_v1';

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error('hexToBytes: expected 64 hex chars');
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

const bytesToBigIntBE = (bytes: Uint8Array): bigint => {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) + BigInt(b);
  return v;
};

/**
 * Generate a valid secp256k1 private key as 32 bytes.
 * - Valid range is 1..n-1.
 * - Random 32-byte numbers fall outside the range extremely rarely, but we validate anyway.
 */
export const generateSecp256k1PrivateKey = (): Uint8Array => {
  // In browsers (including mobile), this is the correct API for cryptographically strong randomness.
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure randomness unavailable (crypto.getRandomValues missing)');
  }

  while (true) {
    const sk = new Uint8Array(32);
    globalThis.crypto.getRandomValues(sk);

    const d = bytesToBigIntBE(sk);
    if (d === 0n) continue; // 0 is invalid
    if (d >= SECP256K1_N) continue; // must be < n
    return sk;
  }
};

/**
 * Encode a private key to NIP-19 nsec.
 * We prefer nostr-tools if present; otherwise we use the local bech32 fallback.
 */
export const encodeNsec = (sk: Uint8Array): string => {
  const nip19 = (nostrTools as any)?.nip19;
  if (nip19?.nsecEncode) return nip19.nsecEncode(sk);
  return bech32Encode('nsec', sk);
};

/**
 * Decode an nsec into raw 32-byte private key.
 * Accepts:
 * - nsec1... strings
 * - 64-char hex strings (for convenience)
 */
export const decodeNsecToBytes = (value: string): Uint8Array => {
  const input = value.trim();

  // Convenience: allow raw 32-byte hex private key.
  if (/^[0-9a-fA-F]{64}$/.test(input)) return hexToBytes(input);

  const nip19 = (nostrTools as any)?.nip19;
  if (nip19?.decode) {
    const decoded = nip19.decode(input);
    if (!decoded || decoded.type !== 'nsec') throw new Error('Not an nsec');
    const data = decoded.data;

    // nostr-tools historically returns Uint8Array for nsec, but we defend against changes.
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string' && /^[0-9a-fA-F]{64}$/.test(data)) return hexToBytes(data);
    throw new Error('Unexpected nsec decode payload');
  }

  // Fallback: local bech32 decode.
  const { hrp, data } = bech32Decode(input);
  if (hrp !== 'nsec') throw new Error('Not an nsec');
  if (data.length !== 32) throw new Error('Invalid nsec length');
  return data;
};

/**
 * Derive a Nostr public key hex (32 bytes, lowercase hex, no prefix) from a private key.
 * We prefer nostr-tools.getPublicKey because the rest of the codebase already uses nostr-tools.
 */
export const getPublicKeyHexFromPrivateKey = (sk: Uint8Array): string => {
  const getPublicKey = (nostrTools as any)?.getPublicKey;
  if (!getPublicKey) throw new Error('nostr-tools.getPublicKey missing');
  const pk = getPublicKey(sk);

  // nostr-tools returns hex string (64 chars). Normalize.
  if (typeof pk !== 'string' || !/^[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error('Invalid pubkey derived');
  }
  return pk.toLowerCase();
};

/* =========================================================================================
   Local key storage helpers (Agora)
   ========================================================================================= */

/**
 * Save an nsec (or raw 64-hex private key) into localStorage as a normalized nsec.
 */
export const savePrivateKeyNsec = (nsecOrHex: string) => {
  const bytes = decodeNsecToBytes(nsecOrHex);
  const nsec = encodeNsec(bytes);
  localStorage.setItem(LS_KEY_NSEC, nsec);
};

/**
 * Save a 64-hex private key into localStorage (stored as nsec for UX).
 */
export const savePrivateKeyHex = (hex: string) => {
  const bytes = hexToBytes(hex);
  const nsec = encodeNsec(bytes);
  localStorage.setItem(LS_KEY_NSEC, nsec);
};

/**
 * Returns nsec string if present.
 */
export const getPrivateKeyNsec = (): string | null => {
  try {
    const v = localStorage.getItem(LS_KEY_NSEC);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
};

/**
 * Returns raw key bytes if present.
 */
export const getPrivateKeyBytes = (): Uint8Array | null => {
  try {
    const nsec = getPrivateKeyNsec();
    if (!nsec) return null;
    return decodeNsecToBytes(nsec);
  } catch {
    return null;
  }
};

/**
 * Returns 64-hex private key if present.
 */
export const getPrivateKeyHex = (): string | null => {
  const bytes = getPrivateKeyBytes();
  if (!bytes) return null;
  return bytesToHex(bytes);
};

export const hasLocalPrivateKey = (): boolean => {
  return Boolean(getPrivateKeyNsec());
};

export const clearPrivateKey = () => {
  try {
    localStorage.removeItem(LS_KEY_NSEC);
  } catch {
    // ignore
  }
};

/* =========================================================================================
   Minimal bech32 implementation (BIP-0173) for our NIP-19 fallback.
   This is intentionally tiny: it supports ONLY what we need (encode/decode for nsec/npub).
   ========================================================================================= */

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CHARSET_REV: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < BECH32_CHARSET.length; i++) map[BECH32_CHARSET[i]] = i;
  return map;
})();

const bech32Polymod = (values: number[]): number => {
  const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk ^= GENERATORS[i];
    }
  }
  return chk;
};

const bech32HrpExpand = (hrp: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
};

const bech32CreateChecksum = (hrp: string, data: number[]): number[] => {
  const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = bech32Polymod(values) ^ 1;
  const ret: number[] = [];
  for (let p = 0; p < 6; p++) ret.push((mod >>> (5 * (5 - p))) & 31);
  return ret;
};

const bech32VerifyChecksum = (hrp: string, data: number[]): boolean => {
  return bech32Polymod(bech32HrpExpand(hrp).concat(data)) === 1;
};

// Convert between bit groups (8-bit bytes <-> 5-bit bech32 words)
const convertBits = (data: Uint8Array | number[], fromBits: number, toBits: number, pad: boolean): number[] => {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data as any) {
    if (value < 0 || (value >> fromBits) !== 0) throw new Error('convertBits: invalid value');
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) ret.push((acc << (toBits - bits)) & maxv);
  } else {
    if (bits >= fromBits) throw new Error('convertBits: excess padding');
    if ((acc << (toBits - bits)) & maxv) throw new Error('convertBits: non-zero padding');
  }
  return ret;
};

const bech32Encode = (hrp: string, payloadBytes: Uint8Array): string => {
  const dataWords = convertBits(payloadBytes, 8, 5, true);
  const checksum = bech32CreateChecksum(hrp, dataWords);
  const combined = dataWords.concat(checksum);
  let out = hrp + '1';
  for (const v of combined) out += BECH32_CHARSET[v];
  return out;
};

const bech32Decode = (bech: string): { hrp: string; data: Uint8Array } => {
  const s = bech.trim().toLowerCase();
  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length) throw new Error('bech32: invalid separator position');

  const hrp = s.slice(0, pos);
  const dataPart = s.slice(pos + 1);

  const dataWords: number[] = [];
  for (const c of dataPart) {
    const v = BECH32_CHARSET_REV[c];
    if (v === undefined) throw new Error('bech32: invalid character');
    dataWords.push(v);
  }
  if (!bech32VerifyChecksum(hrp, dataWords)) throw new Error('bech32: invalid checksum');

  const payloadWords = dataWords.slice(0, -6);
  const bytes = convertBits(payloadWords, 5, 8, false);
  return { hrp, data: new Uint8Array(bytes) };
};

// --- End of File ---
// Filepath: src/utils/auth.ts
// Version: v1.1.0
