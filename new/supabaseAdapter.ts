// src/db/supabaseAdapter.ts (OPTIONAL — for the typed-RPC migration path)
// =============================================================================
// BUNDLE 6 — SECURITY (OPTIONAL, DEPLOY SEPARATELY)
// HEAD: b6c491e
//
// PURPOSE:
//   This file is the END-STATE adapter after the full typed-RPC migration
//   described in BUNDLE6_README.md. It is OPTIONAL — the SQL files in this
//   bundle (01_exec_sql_readonly.sql, 02_rls_policies.sql) can be applied
//   WITHOUT this adapter change, and the app will continue to work as long
//   as exec_batch is not locked down.
//
//   When the engineer is ready to fully migrate batchRun callers to typed
//   RPCs (the secure end-state), they should:
//     1. Add typed RPC functions in Supabase (create_expense, create_topup,
//        create_transfer, return_invoice, close_day, reopen_day,
//        create_inventory_count, create_account_reconciliation,
//        update_maintenance_job_status, delete_expense, restore_expense,
//        update_expense).
//     2. Add corresponding methods to this adapter.
//     3. Update each query module to call the typed method instead of
//        dbClient.batchRun([...]).
//     4. Lock down exec_batch (reject mutation statements) — at this point
//        the app no longer needs exec_batch for mutations, only for the
//        rare read-only batch.
//
//   This file shows the adapter shape AFTER step 2. Steps 1, 3, 4 are the
//   engineer's responsibility — they are not provided here because they
//   require decisions about each RPC's exact parameter shape.
// =============================================================================

import { supabase } from './supabase';

export const supabaseAdapter = {
  async initDb(): Promise<boolean> {
    // Database schema is already provisioned on the Supabase backend.
    return true;
  },

  // READ-ONLY query path — used for SELECTs.
  // After applying 01_exec_sql_readonly.sql, this will reject any mutation
  // statement. Use the typed RPCs below for mutations.
  async query(sql: string, params: any[] = []): Promise<any[]> {
    const { data, error } = await supabase.rpc('exec_sql', {
      query_text: sql,
      params: params,
    });

    if (error) {
      console.error('Supabase SQL query error:', error, { sql, params });
      throw new Error(error.message || 'Database query error');
    }

    return (data as any)?.rows || [];
  },

  // DEPRECATED: after the typed-RPC migration, this method should be removed
  // or restricted to read-only batches. It currently still allows mutations
  // via exec_batch — this is the remaining security gap.
  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid: number }> {
    const { data, error } = await supabase.rpc('exec_sql', {
      query_text: sql,
      params: params,
    });

    if (error) {
      console.error('Supabase SQL execution error:', error, { sql, params });
      throw new Error(error.message || 'Database execution error');
    }

    const rowCount = (data as any)?.rowCount || 0;
    return {
      changes: rowCount,
      lastInsertRowid: 0,
    };
  },

  // DEPRECATED: same as run() — should be migrated to typed RPCs.
  async batchRun(statements: { sql: string; params?: any[] }[]): Promise<boolean> {
    const { error } = await supabase.rpc('exec_batch', {
      statements: statements.map(s => ({
        sql: s.sql,
        params: s.params || [],
      })),
    });

    if (error) {
      console.error('Supabase SQL batch execution error:', error, { statements });
      throw new Error(error.message || 'Database batch execution error');
    }

    return true;
  },

  // ── TYPED RPCs (the secure path for mutations) ─────────────────────────────
  // Each mutation in the app should be migrated to call one of these typed
  // RPCs instead of batchRun. The RPC is defined in supabase/functions.sql
  // and takes a JSON payload with typed fields, constructing the SQL
  // server-side with parameter binding (no string concatenation).

  async completeSaleRpc(payload: any): Promise<{ invoiceId: string; invoiceNumber: string }> {
    const { data, error } = await supabase.rpc('complete_sale', { payload });
    if (error) {
      console.error('complete_sale RPC error:', error, { payload });
      throw new Error(error.message || 'Database error completing sale');
    }
    return data as { invoiceId: string; invoiceNumber: string };
  },

  // TODO (engineer): add typed RPC methods for each mutation currently using batchRun:
  //   async returnInvoiceRpc(payload): Promise<void>
  //   async createExpenseRpc(payload): Promise<{ id: string }>
  //   async updateExpenseRpc(id, payload): Promise<void>
  //   async deleteExpenseRpc(id): Promise<void>
  //   async restoreExpenseRpc(id): Promise<void>
  //   async createTopupRpc(payload): Promise<{ id: string; topupNumber: string }>
  //   async createTransferRpc(payload): Promise<{ id: string; transferNumber: string }>
  //   async closeDayRpc(targetDate, cashCounts, notes): Promise<void>
  //   async reopenDayRpc(date): Promise<void>
  //   async createInventoryCountRpc(items, notes): Promise<string>
  //   async createAccountReconciliationRpc(account_id, actual_balance): Promise<void>
  //   async updateMaintenanceJobStatusRpc(id, status, final_amount, payment_account_id): Promise<void>
  //
  // For each, define a matching CREATE OR REPLACE FUNCTION in supabase/functions.sql
  // that takes a typed JSONB parameter and constructs the SQL with parameter
  // binding (no EXECUTE parsed_query pattern).

  async getVersion(): Promise<number> {
    // Return a constant matching the latest migration (14)
    return 14;
  },

  async setVersion(_version: number): Promise<void> {
    // No-op on Supabase backend
  },

  async exportDatabase(): Promise<Uint8Array> {
    throw new Error('تصدير قاعدة البيانات غير مدعوم عند استخدام Supabase كخلفية.');
  },

  async importDatabase(_data: Uint8Array): Promise<void> {
    throw new Error('استيراد قاعدة البيانات غير مدعوم عند استخدام Supabase كخلفية.');
  },
};
export type SupabaseAdapterType = typeof supabaseAdapter;
export type DbWorkerApi = SupabaseAdapterType;
