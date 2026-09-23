/**
 * Servidor HTTP: API REST do CRUD + arquivos estaticos da interface.
 *
 * Sem framework, sem dependencias: apenas os modulos nativos do Node.
 *   node src/server.js            -> sobe em http://localhost:4173 e abre o navegador
 *   node src/server.js --no-open  -> sobe sem abrir o navegador
 *   PORT=8080 node src/server.js  -> muda a porta
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, resolve, sep } from 'node:path';

import { DB_PATH, PUBLIC_DIR, db } from './db.js';
import {
  ValidationError,
  createItem,
  deleteItem,
  getItem,
  getStats,
  listItems,
  updateItem,
} from './items.js';

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_BODY_BYTES = 100 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ *
 * Helpers HTTP
 * ------------------------------------------------------------------ */

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Corpo da requisicao muito grande.');
    }
    chunks.push(chunk);
  }

  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'JSON invalido no corpo da requisicao.');
  }
}

async function serveStatic(req, res, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = resolve(PUBLIC_DIR, relativePath);

  // Bloqueia path traversal (../../etc/passwd).
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
    throw new HttpError(403, 'Acesso negado.');
  }

  let content;
  try {
    content = await readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      throw new HttpError(404, 'Arquivo nao encontrado.');
    }
    throw error;
  }

  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : content);
}

/* ------------------------------------------------------------------ *
 * Rotas da API
 * ------------------------------------------------------------------ */

async function handleApi(req, res, url, idParam) {
  const method = req.method;
  const id = idParam === null ? null : Number(idParam);

  if (idParam !== null && (!Number.isInteger(id) || id <= 0)) {
    throw new HttpError(400, 'Identificador invalido.');
  }

  // /api/health
  if (id === null && url.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      database: DB_PATH,
      items: getStats().total,
    });
  }

  // /api/items
  if (id === null) {
    if (method === 'GET') {
      const items = listItems({
        search: url.searchParams.get('search'),
        priority: url.searchParams.get('priority'),
        purchased: url.searchParams.get('purchased'),
        sort: url.searchParams.get('sort'),
      });
      return sendJson(res, 200, { items, stats: getStats() });
    }

    if (method === 'POST') {
      const created = createItem(await readJsonBody(req));
      return sendJson(res, 201, { item: created, stats: getStats() });
    }

    throw new HttpError(405, `Metodo ${method} nao permitido em /api/items.`);
  }

  // /api/items/:id
  switch (method) {
    case 'GET': {
      const item = getItem(id);
      if (!item) throw new HttpError(404, 'Item nao encontrado.');
      return sendJson(res, 200, { item });
    }
    case 'PUT':
    case 'PATCH': {
      const updated = updateItem(id, await readJsonBody(req));
      if (!updated) throw new HttpError(404, 'Item nao encontrado.');
      return sendJson(res, 200, { item: updated, stats: getStats() });
    }
    case 'DELETE': {
      if (!deleteItem(id)) throw new HttpError(404, 'Item nao encontrado.');
      return sendJson(res, 200, { deleted: id, stats: getStats() });
    }
    default:
      throw new HttpError(405, `Metodo ${method} nao permitido em /api/items/${id}.`);
  }
}

/* ------------------------------------------------------------------ *
 * Servidor
 * ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  try {
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const match = url.pathname.match(/^\/api\/items(?:\/([^/]+))?\/?$/);
      if (match) return await handleApi(req, res, url, match[1] ?? null);
      if (url.pathname === '/api/health') return await handleApi(req, res, url, null);
      throw new HttpError(404, 'Rota nao encontrada.');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, 'Metodo nao permitido.');
    }
    return await serveStatic(req, res, url.pathname);
  } catch (error) {
    if (res.headersSent) return res.end();

    if (error instanceof ValidationError) {
      return sendJson(res, 400, { error: error.message, fields: error.fields });
    }
    if (error instanceof HttpError) {
      return sendJson(res, error.status, { error: error.message });
    }

    console.error('[erro]', error);
    return sendJson(res, 500, { error: 'Erro interno no servidor.' });
  }
});

function openBrowser(target) {
  if (process.env.WISHLIST_NO_OPEN === '1' || process.argv.includes('--no-open')) return;

  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];

  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Se nao conseguir abrir, o usuario abre a URL manualmente.
  }
}

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  A porta ${PORT} ja esta em uso.`);
    console.error(`  Feche o outro programa ou rode:  PORT=4174 npm start\n`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Lista de Desejos rodando em ${url}`);
  console.log(`  Banco de dados: ${DB_PATH}`);
  console.log(`  (Ctrl+C para parar)\n`);
  openBrowser(url);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
