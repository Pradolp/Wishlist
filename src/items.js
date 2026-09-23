/**
 * Regras de negocio do CRUD: validacao + acesso ao banco.
 *
 * A API fala "camelCase" (price, createdAt...) e o banco fala "snake_case"
 * (price, created_at...). A conversao fica concentrada em toApi().
 */
import { db } from './db.js';

export const PRIORITIES = ['baixa', 'media', 'alta'];

const MAX_NAME = 120;
const MAX_NOTES = 2000;
const MAX_PRICE = 1_000_000_000;

/** Erro de validacao com detalhes por campo (vira HTTP 400). */
export class ValidationError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

/* ------------------------------------------------------------------ *
 * Normalizadores de entrada
 * ------------------------------------------------------------------ */

function asText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** Remove acentos para aceitar "media" e "média". */
function deaccent(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function parseName(raw, { required }) {
  const name = asText(raw);
  if (name === null) {
    return required ? { error: 'Informe o nome do item.' } : { value: null };
  }
  if (name.length > MAX_NAME) {
    return { error: `O nome pode ter no maximo ${MAX_NAME} caracteres.` };
  }
  return { value: name };
}

function parsePrice(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null };

  let number;
  if (typeof raw === 'number') {
    number = raw;
  } else {
    // Aceita "R$ 1.234,56", "1.234,56", "1234.56", "12,50".
    let text = String(raw).trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
    if (text === '') return { value: null };
    text = text.includes(',')
      ? text.replace(/\./g, '').replace(',', '.')
      : text;
    number = Number(text);
  }

  if (!Number.isFinite(number)) return { error: 'Preco invalido.' };
  if (number < 0) return { error: 'O preco nao pode ser negativo.' };
  if (number > MAX_PRICE) return { error: 'Preco acima do limite permitido.' };
  return { value: Math.round(number * 100) / 100 };
}

function parseLink(raw) {
  const text = asText(raw);
  if (text === null) return { value: null };

  // Se o usuario digitar "amazon.com.br/xyz", completa com https://
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'Link invalido. Ex.: https://exemplo.com/produto' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'O link precisa comecar com http:// ou https://' };
  }
  return { value: url.toString() };
}

function parsePriority(raw) {
  const text = asText(raw);
  if (text === null) return { value: 'media' };
  const normalized = deaccent(text).toLowerCase();
  if (!PRIORITIES.includes(normalized)) {
    return { error: `Prioridade deve ser uma de: ${PRIORITIES.join(', ')}.` };
  }
  return { value: normalized };
}

function parsePurchased(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: false };
  if (typeof raw === 'boolean') return { value: raw };
  if (raw === 1 || raw === 0) return { value: raw === 1 };
  if (typeof raw === 'string') {
    const text = deaccent(raw).trim().toLowerCase();
    if (['true', '1', 'sim'].includes(text)) return { value: true };
    if (['false', '0', 'nao'].includes(text)) return { value: false };
  }
  return { error: 'O campo "purchased" deve ser true ou false.' };
}

function parseNotes(raw) {
  const notes = asText(raw);
  if (notes === null) return { value: null };
  if (notes.length > MAX_NOTES) {
    return { error: `As observacoes podem ter no maximo ${MAX_NOTES} caracteres.` };
  }
  return { value: notes };
}

/**
 * Valida o corpo da requisicao.
 * - `partial: false` (POST): `name` e obrigatorio, os demais campos sao opcionais.
 * - `partial: true`  (PUT/PATCH): so os campos enviados sao validados/atualizados.
 */
export function validateItem(input, { partial = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Corpo da requisicao invalido: envie um objeto JSON.');
  }

  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const fields = {};
  const values = {};

  const rules = {
    // O nome e sempre obrigatorio quando enviado: nunca aceita string vazia.
    name: () => parseName(input.name, { required: true }),
    price: () => parsePrice(input.price),
    link: () => parseLink(input.link),
    priority: () => parsePriority(input.priority),
    purchased: () => parsePurchased(input.purchased),
    notes: () => parseNotes(input.notes),
  };

  for (const [key, rule] of Object.entries(rules)) {
    if (partial && !has(key)) continue;

    const result = rule();
    if (result.error) fields[key] = result.error;
    else values[key] = result.value;
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError('Nao foi possivel salvar: verifique os campos destacados.', fields);
  }
  if (partial && Object.keys(values).length === 0) {
    throw new ValidationError('Nenhum campo valido foi enviado para atualizacao.');
  }
  return values;
}

/* ------------------------------------------------------------------ *
 * Acesso ao banco
 * ------------------------------------------------------------------ */

function toApi(row) {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    link: row.link,
    priority: row.priority,
    purchased: row.purchased === 1,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    purchasedAt: row.purchased_at,
  };
}

const ORDER_BY = {
  recent: 'created_at DESC, id DESC',
  oldest: 'created_at ASC, id ASC',
  name: 'name COLLATE NOCASE ASC',
  priority:
    "CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, created_at DESC",
  price_desc: 'price IS NULL, price DESC',
  price_asc: 'price IS NULL, price ASC',
};

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

export const SORT_OPTIONS = Object.keys(ORDER_BY);

/** Lista os itens, com filtros e ordenacao opcionais (todos validados em whitelist). */
export function listItems({ search, priority, purchased, sort } = {}) {
  const where = [];
  const params = {};

  const term = asText(search);
  if (term) {
    where.push(
      `(name LIKE :search ESCAPE '\\'
        OR IFNULL(notes, '') LIKE :search ESCAPE '\\'
        OR IFNULL(link, '') LIKE :search ESCAPE '\\')`,
    );
    params.search = `%${escapeLike(term)}%`;
  }

  const wantedPriority = asText(priority);
  if (wantedPriority && wantedPriority !== 'all') {
    const normalized = deaccent(wantedPriority).toLowerCase();
    if (!PRIORITIES.includes(normalized)) {
      throw new ValidationError('Filtro de prioridade invalido.', {
        priority: `Use uma de: ${PRIORITIES.join(', ')}.`,
      });
    }
    where.push('priority = :priority');
    params.priority = normalized;
  }

  const wantedPurchased = asText(purchased);
  if (wantedPurchased === 'pending') where.push('purchased = 0');
  else if (wantedPurchased === 'purchased') where.push('purchased = 1');
  else if (wantedPurchased && wantedPurchased !== 'all') {
    throw new ValidationError('Filtro de status invalido.', {
      purchased: 'Use "all", "pending" ou "purchased".',
    });
  }

  const orderBy = ORDER_BY[sort] ?? ORDER_BY.recent;
  const sql = `
    SELECT * FROM items
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${orderBy}
  `;

  const statement = db.prepare(sql);
  const rows = statement.all(params);
  return rows.map(toApi);
}

/** Resumo da lista inteira (nao depende dos filtros). */
export function getStats() {
  const row = db
    .prepare(
      `SELECT
         COUNT(*)                     AS total,
         COALESCE(SUM(purchased), 0)  AS purchased,
         COALESCE(SUM(CASE WHEN purchased = 0 THEN 1 ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN purchased = 0 THEN COALESCE(price, 0) ELSE 0 END), 0) AS pending_total,
         COALESCE(SUM(CASE WHEN purchased = 1 THEN COALESCE(price, 0) ELSE 0 END), 0) AS purchased_total,
         COALESCE(SUM(CASE WHEN price IS NULL THEN 1 ELSE 0 END), 0) AS without_price
       FROM items`,
    )
    .get();

  return {
    total: row.total,
    purchased: row.purchased,
    pending: row.pending,
    pendingTotal: row.pending_total,
    purchasedTotal: row.purchased_total,
    withoutPrice: row.without_price,
  };
}

export function getItem(id) {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  return row ? toApi(row) : null;
}

export function createItem(input) {
  const values = validateItem(input, { partial: false });
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO items (name, price, link, priority, purchased, notes, created_at, updated_at, purchased_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.name,
      values.price ?? null,
      values.link ?? null,
      values.priority,
      values.purchased ? 1 : 0,
      values.notes ?? null,
      now,
      now,
      values.purchased ? now : null,
    );

  return getItem(Number(result.lastInsertRowid));
}

export function updateItem(id, input) {
  const current = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!current) return null;

  const values = validateItem(input, { partial: true });
  const now = new Date().toISOString();

  const next = {
    name: values.name ?? current.name,
    price: 'price' in values ? values.price : current.price,
    link: 'link' in values ? values.link : current.link,
    priority: values.priority ?? current.priority,
    purchased: 'purchased' in values ? values.purchased : current.purchased === 1,
    notes: 'notes' in values ? values.notes : current.notes,
  };

  // Mantem a data da compra coerente com o status.
  let purchasedAt = current.purchased_at;
  if (next.purchased && current.purchased !== 1) purchasedAt = now;
  if (!next.purchased) purchasedAt = null;

  db.prepare(
    `UPDATE items
        SET name = ?, price = ?, link = ?, priority = ?, purchased = ?,
            notes = ?, purchased_at = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    next.name,
    next.price ?? null,
    next.link ?? null,
    next.priority,
    next.purchased ? 1 : 0,
    next.notes ?? null,
    purchasedAt ?? null,
    now,
    id,
  );

  return getItem(id);
}

export function deleteItem(id) {
  const result = db.prepare('DELETE FROM items WHERE id = ?').run(id);
  return result.changes > 0;
}
