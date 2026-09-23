/**
 * Camada HTTP (src/server.js): status codes, JSON da API e arquivos estaticos.
 *
 * O servidor sobe em uma porta aleatoria (`port: 0`) e usa um banco temporario
 * definido em WISHLIST_DB antes do import do modulo.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

const tempDir = mkdtempSync(join(tmpdir(), 'wishlist-api-'));
process.env.WISHLIST_DB = join(tempDir, 'wishlist.db');
process.env.WISHLIST_NO_OPEN = '1';

const { startServer, stopServer } = await import('../src/server.js');

let baseUrl = '';

before(async () => {
  baseUrl = await startServer({ port: 0 });
});

after(async () => {
  await stopServer();
  rmSync(tempDir, { recursive: true, force: true });
});

/** Chamada HTTP que devolve status, corpo (texto) e JSON quando houver. */
async function call(method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();

  let data = null;
  try {
    data = text === '' ? null : JSON.parse(text);
  } catch {
    data = null;
  }

  return { status: response.status, data, text, headers: response.headers };
}

/** Requisicao crua: o `fetch` normalizaria caminhos com "..". */
function rawGet(path) {
  const { port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

/** Cria um item pela propria API (garante que o teste passa pelo HTTP). */
async function createItemVia(overrides = {}) {
  const { status, data } = await call('POST', '/api/items', { name: 'Item de teste', ...overrides });
  assert.equal(status, 201, `POST /api/items deveria responder 201: ${JSON.stringify(data)}`);
  return data.item;
}

describe('API HTTP', () => {
  it('GET /api/health responde ok com o caminho do banco', async () => {
    const { status, data } = await call('GET', '/api/health');

    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(typeof data.items, 'number');
    assert.match(data.database, /\.db$/);
  });

  it('faz o ciclo completo: criar, ler, atualizar e remover', async () => {
    const created = await createItemVia({
      name: 'Fone Bluetooth',
      price: 'R$ 1.234,56',
      link: 'amazon.com.br/fone',
    });
    assert.equal(created.price, 1234.56);
    assert.equal(created.link, 'https://amazon.com.br/fone');
    assert.equal(created.purchased, false);

    const lido = await call('GET', `/api/items/${created.id}`);
    assert.equal(lido.status, 200);
    assert.deepEqual(lido.data.item, created);

    const comprado = await call('PATCH', `/api/items/${created.id}`, { purchased: true });
    assert.equal(comprado.status, 200);
    assert.equal(comprado.data.item.purchased, true);
    assert.ok(comprado.data.item.purchasedAt);
    assert.equal(typeof comprado.data.stats.total, 'number');

    const removido = await call('DELETE', `/api/items/${created.id}`);
    assert.equal(removido.status, 200);
    assert.equal(removido.data.deleted, created.id);

    const depois = await call('GET', `/api/items/${created.id}`);
    assert.equal(depois.status, 404);
  });

  it('PUT tambem atualiza parcialmente, como o PATCH', async () => {
    const item = await createItemVia({ name: 'Teclado', price: 100, notes: 'ABNT2' });

    const { status, data } = await call('PUT', `/api/items/${item.id}`, { notes: 'ABNT' });

    assert.equal(status, 200);
    assert.equal(data.item.notes, 'ABNT');
    assert.equal(data.item.price, 100);
  });

  it('devolve 400 com os campos invalidos quando a validacao falha', async () => {
    const { status, data } = await call('POST', '/api/items', { name: '', price: -5, link: 'ftp://x' });

    assert.equal(status, 400);
    assert.deepEqual(Object.keys(data.fields).sort(), ['link', 'name', 'price']);
    assert.equal(typeof data.error, 'string');
  });

  it('devolve 400 para JSON invalido ou corpo que nao e objeto', async () => {
    const invalido = await call('POST', '/api/items', '{nome: ');
    assert.equal(invalido.status, 400);
    assert.match(invalido.data.error, /JSON invalido/);

    const array = await call('POST', '/api/items', []);
    assert.equal(array.status, 400);
    assert.match(array.data.error, /objeto JSON/);
  });

  it('valida o identificador que vem na URL', async () => {
    for (const id of ['abc', '0', '-3', '1.5']) {
      const { status, data } = await call('GET', `/api/items/${id}`);
      assert.equal(status, 400, `id "${id}" deveria ser recusado`);
      assert.match(data.error, /Identificador invalido/);
    }
  });

  it('devolve 404 para item ou rota inexistente', async () => {
    const item = await call('GET', '/api/items/999999');
    assert.equal(item.status, 404);
    assert.match(item.data.error, /Item nao encontrado/);

    const rota = await call('GET', '/api/nao-existe');
    assert.equal(rota.status, 404);
    assert.match(rota.data.error, /Rota nao encontrada/);

    const remocao = await call('DELETE', '/api/items/999999');
    assert.equal(remocao.status, 404);
  });

  it('rejeita metodos nao suportados com 405', async () => {
    const colecao = await call('PUT', '/api/items', { name: 'x' });
    assert.equal(colecao.status, 405);

    const raiz = await call('POST', '/', { name: 'x' });
    assert.equal(raiz.status, 405);
  });

  it('filtra e ordena pela query string', async () => {
    await createItemVia({ name: 'Filtro Alta', priority: 'alta' });
    const baixa = await createItemVia({ name: 'Filtro Baixa', priority: 'baixa', price: 20 });

    const alta = await call('GET', '/api/items?priority=alta&search=Filtro');
    assert.equal(alta.status, 200);
    assert.deepEqual(alta.data.items.map((item) => item.name), ['Filtro Alta']);

    await call('PATCH', `/api/items/${baixa.id}`, { purchased: true });
    const comprados = await call('GET', '/api/items?purchased=purchased&search=Filtro');
    assert.deepEqual(comprados.data.items.map((item) => item.name), ['Filtro Baixa']);

    const pendentes = await call('GET', '/api/items?purchased=pending&search=Filtro');
    assert.deepEqual(pendentes.data.items.map((item) => item.name), ['Filtro Alta']);

    const invalido = await call('GET', '/api/items?priority=urgente');
    assert.equal(invalido.status, 400);
    assert.ok(invalido.data.fields.priority);

    // Ordenacao desconhecida nao quebra: cai no padrao.
    const semOrdenacao = await call('GET', '/api/items?sort=inventado');
    assert.equal(semOrdenacao.status, 200);
  });

  it('trata % e _ da busca como literais tambem pela API', async () => {
    await createItemVia({ name: 'Cupom 50% off' });
    await createItemVia({ name: 'Cupom 500 reais' });

    const { data } = await call('GET', `/api/items?search=${encodeURIComponent('50%')}`);
    assert.deepEqual(data.items.map((item) => item.name), ['Cupom 50% off']);
  });

  it('devolve stats na listagem e atualiza a cada escrita', async () => {
    const antes = await call('GET', '/api/items?search=Estatistica');
    assert.equal(typeof antes.data.stats.total, 'number');

    await createItemVia({ name: 'Estatistica 1', price: 30 });

    const depois = await call('GET', '/api/items?search=Estatistica');
    assert.equal(depois.data.stats.total, antes.data.stats.total + 1);
    assert.equal(depois.data.stats.pendingTotal, antes.data.stats.pendingTotal + 30);
  });

  it('serve o front-end com os content-types corretos', async () => {
    const pagina = await call('GET', '/');
    assert.equal(pagina.status, 200);
    assert.match(pagina.headers.get('content-type'), /text\/html/);
    assert.match(pagina.text, /Lista de Desejos/);

    const app = await call('GET', '/app.js');
    assert.equal(app.status, 200);
    assert.match(app.headers.get('content-type'), /text\/javascript/);

    const css = await call('GET', '/styles.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
  });

  it('devolve 404 para arquivo estatico inexistente', async () => {
    const { status } = await call('GET', '/nao-existe.js');
    assert.equal(status, 404);
  });

  it('responde HEAD sem corpo', async () => {
    const response = await fetch(`${baseUrl}/`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
  });

  it('bloqueia path traversal para fora de public/', async () => {
    // "../" literal: a propria URL normaliza e o arquivo nao existe em public/.
    const normalizado = await rawGet('/../package.json');
    assert.equal(normalizado.status, 404);

    // "%2e%2e%2f" escapa da normalizacao e e barrado pela checagem de prefixo.
    const codificado = await rawGet('/%2e%2e%2fpackage.json');
    assert.equal(codificado.status, 403);

    for (const body of [normalizado.body, codificado.body]) {
      assert.ok(!body.includes('wishlist'), 'nao pode vazar conteudo de fora de public/');
    }
  });

  it('recusa corpo grande demais com 413', async () => {
    const { status } = await call('POST', '/api/items', { name: 'x', notes: 'a'.repeat(150 * 1024) });
    assert.equal(status, 413);
  });
});
