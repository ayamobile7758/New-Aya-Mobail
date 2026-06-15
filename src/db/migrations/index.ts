import { dbClient } from '../client';
// @ts-ignore
import initSql from './001_init.sql?raw';
// @ts-ignore
import removeDebtsSql from './002_remove_debts.sql?raw';
// @ts-ignore
import snapshotsSql from './003_snapshots.sql?raw';
// @ts-ignore
import productsMediaSql from './004_products_media.sql?raw';
// @ts-ignore
import reportsCostingSql from './005_reports_costing.sql?raw';
// @ts-ignore
import auditLogSql from './006_audit_log.sql?raw';
// @ts-ignore
import categoriesSql from './007_categories.sql?raw';
// @ts-ignore
import giftItemsSql from './008_gift_items.sql?raw';
// @ts-ignore
import partialReturnsSql from './009_partial_returns.sql?raw';
// @ts-ignore
import dayClosuresSql from './010_day_closures.sql?raw';
// @ts-ignore
import indexesSql from './011_indexes.sql?raw';
// @ts-ignore
import multidevicePrepSql from './012_multidevice_prep.sql?raw';
// @ts-ignore
import addTopupMaintenanceToClosuresSql from './013_add_topup_maintenance_to_closures.sql?raw';

import { supabaseAdapter } from '../supabaseAdapter';

const migrations = [
  { version: 1, sql: initSql },
  { version: 2, sql: removeDebtsSql },
  { version: 3, sql: snapshotsSql },
  { version: 4, sql: productsMediaSql },
  { version: 5, sql: reportsCostingSql },
  { version: 6, sql: auditLogSql },
  { version: 7, sql: categoriesSql },
  { version: 8, sql: giftItemsSql },
  { version: 9, sql: partialReturnsSql },
  { version: 10, sql: dayClosuresSql },
  { version: 11, sql: indexesSql },
  { version: 12, sql: multidevicePrepSql },
  { version: 13, sql: addTopupMaintenanceToClosuresSql },
];

export async function runMigrations() {
  if (dbClient === supabaseAdapter) {
    console.log('Using Supabase backend. Skipping SQLite migrations.');
    return;
  }

  const currentVersion = await dbClient.getVersion();
  console.log(`Current DB version: ${currentVersion}`);


  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      console.log(`Running migration ${migration.version}...`);
      try {
        // Wrap each migration in a transaction so a mid-script failure rolls
        // back all statements and leaves the version unchanged.
        // PRAGMA user_version is set both inside the SQL file (if present)
        // and explicitly here to guarantee consistency.
        await dbClient.run(
          `BEGIN TRANSACTION;\n${migration.sql}\nPRAGMA user_version = ${migration.version};\nCOMMIT;`
        );
        // Keep setVersion call for any code that uses dbClient.getVersion()
        await dbClient.setVersion(migration.version);
        console.log(`Migration ${migration.version} applied successfully.`);
      } catch (err) {
        try { await dbClient.run('ROLLBACK;'); } catch (_) {}
        console.error(`Migration ${migration.version} failed:`, err);
        throw err;
      }
    }
  }
}
