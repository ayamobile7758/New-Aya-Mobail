import { supabase } from './supabase';
import { QueryClient } from '@tanstack/react-query';

export function setupRealtimeSync(queryClient: QueryClient) {
  // Mapping of Postgres tables to React Query keys that need invalidation on change
  const tableKeyMapping: Record<string, string[]> = {
    products: ['products', 'deleted_products'],
    categories: ['categories', 'deleted_categories'],
    accounts: ['active-accounts', 'accounts', 'deleted_accounts'],
    invoices: ['invoices', 'invoice-detail', 'report', 'pnl', 'daily-summary', 'discountLines', 'giftLines', 'discountSummary', 'giftSummary'],
    invoice_items: ['invoices', 'invoice-detail', 'report', 'pnl', 'daily-summary', 'discountLines', 'giftLines', 'discountSummary', 'giftSummary'],
    invoice_payments: ['invoices', 'invoice-detail', 'report', 'pnl', 'daily-summary', 'active-accounts'],
    expenses: ['expenses', 'report', 'pnl', 'daily-summary'],
    expense_categories: ['expense_categories', 'expenses'],
    maintenance_jobs: ['maintenance_jobs', 'deleted_jobs', 'report', 'pnl', 'daily-summary'],
    day_closures: ['day-status', 'day-status-row', 'day-closures-history', 'daily-summary'],
    ledger_entries: ['ledger-entries', 'ledger-period'],
    topups: ['report', 'pnl', 'daily-summary'],
    sequences: [], 
    audit_log: ['audit_log', 'audit_actions', 'audit_devices'],
  };

  console.log('Initializing Supabase Realtime Sync...');

  const channel = supabase
    .channel('schema-db-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public' },
      (payload) => {
        const table = payload.table;
        console.log(`Realtime DB change detected on table: ${table}`, payload.eventType);
        const keysToInvalidate = tableKeyMapping[table];
        if (keysToInvalidate) {
          keysToInvalidate.forEach(key => {
            queryClient.invalidateQueries({ queryKey: [key] });
          });
        }
      }
    )
    .subscribe((status) => {
      console.log('Supabase Realtime subscription status:', status);
    });

  return () => {
    console.log('Cleaning up Supabase Realtime Sync...');
    supabase.removeChannel(channel);
  };
}
