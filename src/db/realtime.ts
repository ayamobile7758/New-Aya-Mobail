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
    transfers: ['ledger-entries', 'ledger-period', 'active-accounts'],
    inventory_count_items: ['inventory-counts'],
    sequences: [], 
    audit_log: ['audit_log', 'audit_actions', 'audit_devices'],
  };

  if (import.meta.env.DEV) {
    console.log('Initializing Supabase Realtime Sync...');
  }

  const pendingInvalidations = new Set<string>();
  let debounceTimer: any = null;

  const channel = supabase
    .channel('schema-db-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public' },
      (payload) => {
        const table = payload.table;
        if (import.meta.env.DEV) {
          console.log(`Realtime DB change detected on table: ${table}`, payload.eventType);
        }
        const keysToInvalidate = tableKeyMapping[table];
        if (keysToInvalidate) {
          keysToInvalidate.forEach(key => {
            pendingInvalidations.add(key);
          });

          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }

          debounceTimer = setTimeout(() => {
            pendingInvalidations.forEach(key => {
              queryClient.invalidateQueries({ queryKey: [key] });
            });
            pendingInvalidations.clear();
            debounceTimer = null;
          }, 450);
        }
      }
    )
    .subscribe((status) => {
      if (import.meta.env.DEV) {
        console.log('Supabase Realtime subscription status:', status);
      }
    });

  return () => {
    if (import.meta.env.DEV) {
      console.log('Cleaning up Supabase Realtime Sync...');
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    supabase.removeChannel(channel);
  };
}
