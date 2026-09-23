/**
 * Conexao com o banco de dados.
 *
 * Usa o modulo `node:sqlite`, que ja vem embutido no Node.js (>= 22.5).
 * Ou seja: nenhuma dependencia externa, nenhum servidor de banco para instalar.
 * O banco e um unico arquivo em `data/wishlist.db`.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = join(ROOT_DIR, 'public');
export const DB_PATH = process.env.WISHLIST_DB
  ? resolve(process.env.WISHLIST_DB)
  : join(ROOT_DIR, 'data', 'wishlist.db');

// Garante que a pasta do banco exista antes de abrir o arquivo.
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// WAL: leituras nao bloqueiam escritas. Bom o suficiente para uso pessoal.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    price        REAL,
    link         TEXT,
    priority     TEXT    NOT NULL DEFAULT 'media'
                 CHECK (priority IN ('baixa', 'media', 'alta')),
    purchased    INTEGER NOT NULL DEFAULT 0
                 CHECK (purchased IN (0, 1)),
    notes        TEXT,
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL,
    purchased_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_items_created_at ON items (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_items_purchased  ON items (purchased);
`);
