// Standalone migration runner. Opening the connection applies any pending
// migrations (idempotent); this script just makes that explicit for CI/ops and
// reports the schema version. Run: `npm run migrate`.
import { getDb } from './connection.js';
import { LATEST_VERSION } from './migrations.js';
import { config } from '../config.js';

const db = getDb();
const version = db.prepare('PRAGMA user_version').get().user_version;
console.log(`Database ${config.dbFile}`);
console.log(`Schema version: ${version} (latest: ${LATEST_VERSION}). Up to date.`);
