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

const migrations = [
  { version: 1, sql: initSql },
  { version: 2, sql: removeDebtsSql },
  { version: 3, sql: snapshotsSql },
  { version: 4, sql: productsMediaSql },
  { version: 5, sql: reportsCostingSql },
  { version: 6, sql: auditLogSql },
  { version: 7, sql: categoriesSql },
  { version: 8, sql: giftItemsSql },
];

export async function runMigrations() {
  const currentVersion = await dbClient.getVersion();
  console.log(`Current DB version: ${currentVersion}`);

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      console.log(`Running migration ${migration.version}...`);
      try {
        // Execute migration as a single script
        // Note: SQLite exec() supports multiple statements separated by ';'
        await dbClient.run(migration.sql);
        await dbClient.setVersion(migration.version);
        console.log(`Migration ${migration.version} applied successfully.`);
      } catch (err) {
        console.error(`Migration ${migration.version} failed:`, err);
        throw err; // Stop application on migration failure
      }
    }
  }
}
