import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
// @ts-ignore - Ignore TS error missing declaration for wasm module import
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import * as Comlink from 'comlink';

let db: any = null;
let sqlite3: any = null;

const api = {
  async initDb() {
    if (db) return true;
    
    try {
      sqlite3 = await (sqlite3InitModule as any)({
        locateFile: (file: string) => file === 'sqlite3.wasm' ? wasmUrl : file,
      });

      console.log('SQLite3 version', sqlite3.version.libVersion);
      
      let poolUtil;
      let retries = 10;
      while (retries > 0) {
        try {
          poolUtil = await sqlite3.installOpfsSAHPoolVfs({
            name: 'pos_sahpool',
            directory: 'pos_db',
            clearOnInit: false,
          });
          break;
        } catch (e: any) {
          if (e.name === 'NoModificationAllowedError' || e.message?.includes('Access Handles') || e.message?.includes('locked')) {
            console.warn('OPFS locked, retrying...', retries);
            await new Promise(r => setTimeout(r, 500));
            retries--;
            if (retries === 0) {
              console.warn('OPFS SAH Pool failed to initialize. Falling back to an in-memory database to allow the app to run.');
              break;
            }
          } else {
            throw e;
          }
        }
      }

      if (poolUtil) {
        console.log('OPFS SAH Pool VFS deployed:', poolUtil);
        if (poolUtil.OpfsSAHPoolDb) {
          db = new poolUtil.OpfsSAHPoolDb('/pos_data.db');
        } else {
          db = new sqlite3.oo1.OpfsSAHPoolDb('/pos_data.db');
        }
      } else {
        // Fallback to memory db if OPFS is unavailable or permanently locked
        db = new sqlite3.oo1.DB('/pos_data.db', 'c');
      }
      console.log('Database opened');

      // Optimizations matching standard WAL but using OPFS SAH semantics
      db.exec('PRAGMA synchronous = NORMAL;');
      db.exec('PRAGMA foreign_keys = ON;');
      db.exec('PRAGMA temp_store = MEMORY;');
      db.exec('PRAGMA journal_mode = WAL;');

      return true;
    } catch (err: any) {
      console.error('Initialization error:', err.name, err.message);
      throw err;
    }
  },

  async query(sql: string, params: any[] = []) {
    if (!db) throw new Error('DB not initialized');
    const results: any[] = [];
    db.exec({
      sql,
      bind: params,
      rowMode: 'object',
      resultRows: results,
    });
    return results;
  },

  async run(sql: string, params: any[] = []) {
    if (!db) throw new Error('DB not initialized');
    let changes = 0;
    let lastInsertRowid = 0;
    db.exec({
      sql,
      bind: params,
    });
    changes = db.changes();
    try {
      lastInsertRowid = db.selectValue('SELECT last_insert_rowid()');
    } catch(e) {}
    
    return { changes, lastInsertRowid };
  },

  async batchRun(statements: { sql: string; params?: any[] }[]) {
     if (!db) throw new Error('DB not initialized');
     db.exec('BEGIN TRANSACTION;');
     try {
       for (const stmt of statements) {
         db.exec({
           sql: stmt.sql,
           bind: stmt.params || [],
         });
       }
       db.exec('COMMIT;');
       return true;
     } catch(e) {
       db.exec('ROLLBACK;');
       throw e;
     }
  },
  
  async getVersion(): Promise<number> {
    if (!db) throw new Error("DB not initialized");
    return db.selectValue('PRAGMA user_version;');
  },
  
  async setVersion(version: number): Promise<void> {
    if (!db) throw new Error("DB not initialized");
    db.exec(`PRAGMA user_version = ${version};`);
  },

  async exportDatabase(): Promise<Uint8Array> {
    if (!db || !sqlite3) throw new Error('DB not initialized');
    return sqlite3.capi.sqlite3_js_db_export(db);
  },

  async importDatabase(data: Uint8Array): Promise<void> {
    if (!db || !sqlite3) throw new Error('DB not initialized');
    const p = sqlite3.wasm.allocFromTypedArray(data);
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      'main',
      p,
      data.byteLength,
      data.byteLength,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
    );
    if (rc !== 0) {
      throw new Error(`Failed to deserialize database, code: ${rc}`);
    }
  }
};

Comlink.expose(api);
export type DbWorkerApi = typeof api;
