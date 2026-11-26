import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
mkdirSync(join(DATA_DIR, 'media', 'audio'), { recursive: true });
mkdirSync(join(DATA_DIR, 'media', 'covers'), { recursive: true });

export function openDb(file = join(DATA_DIR, 'auralys.db')) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  for (const f of readdirSync(join(ROOT, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    db.exec('BEGIN');
    try { db.exec(readFileSync(join(ROOT, 'migrations', f), 'utf8')); db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(f, Date.now()); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  const cache = new Map();
  const stmt = sql => cache.get(sql) || (cache.set(sql, db.prepare(sql)), cache.get(sql));
  return {
    raw: db,
    all: (sql, ...p) => stmt(sql).all(...p),
    get: (sql, ...p) => stmt(sql).get(...p),
    run: (sql, ...p) => stmt(sql).run(...p),
    tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    close: () => db.close()
  };
}
export const uid = (n = 9) => randomBytes(n).toString('base64url');
