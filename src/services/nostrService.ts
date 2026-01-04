// Filepath: src/services/nostrService.ts
// Version: v0.0.2
// Purpose:
// - DEPRECATED legacy Nostr service.
// - Agora Marketplace uses src/utils/nostr.ts + hooks/useAgoraData.ts as the authoritative network layer.
//
// Why this file still exists:
// - Some earlier code paths referenced it.
// - We keep it compiling cleanly for now to avoid breaking imports while we consolidate.
//
// IMPORTANT:
// - Do not add new usages of this service.
// - When consolidation is complete, delete this file and update any remaining imports.

export type MarketplaceEvent = any;

/**
 * Legacy: fetch marketplace events.
 *
 * Current behavior:
 * - Returns an empty list.
 * - This prevents TypeScript build failures without introducing duplicate network logic.
 */
export async function fetchMarketplaceEvents(_userPublicKey: string): Promise<MarketplaceEvent[]> {
  return [];
}

/**
 * Legacy: publish an event.
 *
 * Current behavior:
 * - Throws a clear error so accidental runtime usage is obvious.
 */
export async function publishEvent(_privateKeyHex: string, _content: string): Promise<any> {
  throw new Error('nostrService.ts is deprecated. Use hooks/useAgoraData.ts + utils/nostr.ts instead.');
}

// --- End of File ---
// Filepath: src/services/nostrService.ts
// Version: v0.0.2
