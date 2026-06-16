// src/db/client.ts
// =============================================================================
// BUNDLE 5 — Cloud-Only Cleanup (A-1)
// HEAD: b6c491e
//
// OWNER DECISION: commit to Supabase-only. No offline mode, no SQLite-WASM.
//
// WHAT CHANGED:
//   - Removed the commented-out Comlink/SQLite worker code (10 lines of dead
//     comments at the top of the file).
//   - `dbClient` is unconditionally `supabaseAdapter` (was already the case
//     at runtime, but now the source code reflects it cleanly).
//   - `isSupabaseMode()` now returns `true` unconditionally (was already true
//     whenever VITE_SUPABASE_URL was set, which is always required).
//   - The dead `worker.ts` file should be moved to `src/db/_archived/worker.ts.sqlite-mode.txt`
//     (the engineer should do this manually — see BUNDLE5_NOTES.md).
// =============================================================================

import { supabaseAdapter } from './supabaseAdapter';

// The system is Supabase-only. The SQLite-WASM adapter has been removed.
// Offline resilience is NOT provided — the app requires an always-on internet
// connection. Network failures during a sale show a clear Arabic error and
// preserve the cart (see supabaseAdapter.completeSaleRpc + PaymentDialog
// onError toast). The owner simply retries when the connection returns.
export const dbClient = supabaseAdapter;

export async function initDatabase() {
  await dbClient.initDb();
}

export const isSupabaseMode = (): boolean => true;
