import { supabase } from './supabase';

export const supabaseAdapter = {
  async initDb(): Promise<boolean> {
    // Database schema is already provisioned on the Supabase backend.
    return true;
  },

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
      lastInsertRowid: 0, // App uses nanoid()/RETURNING for keys
    };
  },

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

  async completeSaleRpc(payload: any): Promise<{ invoiceId: string; invoiceNumber: string }> {
    const { data, error } = await supabase.rpc('complete_sale', {
      payload,
    });

    if (error) {
      console.error('complete_sale RPC error:', error, { payload });
      throw new Error(error.message || 'Database error completing sale');
    }

    return data as { invoiceId: string; invoiceNumber: string };
  },

  async getVersion(): Promise<number> {
    // Return a constant matching the latest migration (13)
    // so runMigrations() does not replay SQLite migrations.
    return 13;
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
