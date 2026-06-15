// import * as Comlink from 'comlink';
// import type { DbWorkerApi as WorkerApi } from './worker';
// 
// const worker = new Worker(new URL('./worker.ts', import.meta.url), {
//   type: 'module',
// });
// 
// // Create Comlink proxy
// export const dbClient = Comlink.wrap<WorkerApi>(worker);

import { supabaseAdapter } from './supabaseAdapter';

// Switch to Supabase adapter
export const dbClient = supabaseAdapter;

export async function initDatabase() {
  await dbClient.initDb();
}

export const isSupabaseMode = (): boolean => {
  return !!import.meta.env.VITE_SUPABASE_URL;
};

