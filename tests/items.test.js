/**
 * Regras de negocio: validacao de entrada e CRUD (src/items.js).
 *
 * Roda contra um banco SQLite temporario. `WISHLIST_DB` e lido por src/db.js
 * no momento do import, por isso os imports aqui sao dinamicos: a variavel
 * precisa estar definida antes.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

const tempDir = mkdtempSync(join(tmpdir(), 'wishlist-items-'));
process.env.WISHLIST_DB = join(tempDir, 'wishlist.db');

const { db } = await import('../src/db.js');
const {
  PRIORITIES,
  SORT_OPTIONS,
  ValidationError,
  createItem,
  deleteItem,
  getItem,
  getStats,
  listItems,
  updateItem,
  validateItem,
} = await import('../src/items.js');

// Cada teste comeca com a tabela vazia (e ids voltando ao 1).
beforeEach(() => {
  db.exec('DELETE FROM items');
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'items'");
});

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

/** Executa fn e devolve o erro lancado (falha o teste se nao houver erro). */
function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail('esperava que uma excecao fosse lancada');
}

/** Mensagem de erro do campo indicado em uma criacao invalida. */
function fieldError(input, field) {
  const error = captureError(() => validateItem(input));
  assert.ok(error instanceof ValidationError, `esperava ValidationError, veio ${error.name}`);
  return error.fields[field];
}

const names = (items) => items.map((item) => item.name);

describe('validateItem', () => {
  it('exige nome em criacoes e rejeita string vazia', () => {
    assert.equal(fieldError({}, 'name'), 'Informe o nome do item.');
    assert.ok(fieldError({ name: '   ' }, 'name'));
  });

  it('remove espacos das pontas e limita o nome a 120 caracteres', () => {
    assert.equal(validateItem({ name: '  Fone Bluetooth  ' }).name, 'Fone Bluetooth');
    assert.equal(validateItem({ name: 'x'.repeat(120) }).name.length, 120);
    assert.match(fieldError({ name: 'x'.repeat(121) }, 'name'), /no maximo 120/);
  });

  it('aceita preco em varios formatos (pt-BR, ponto, numero)', () => {
    const cases = [
      ['R$ 1.234,56', 1234.56],
      ['1.234,56', 1234.56],
      ['1234.56', 1234.56],
      ['12,50', 12.5],
      ['10,999', 11],
      [42, 42],
      ['0', 0],
    ];
    for (const [input, expected] of cases) {
      assert.equal(validateItem({ name: 'x', price: input }).price, expected, `preco "${input}"`);
    }
    assert.equal(validateItem({ name: 'x', price: '   ' }).price, null);
    assert.equal(validateItem({ name: 'x' }).price, null);
  });

  it('recusa preco invalido, negativo ou acima do limite', () => {
    assert.match(fieldError({ name: 'x', price: 'abc' }, 'price'), /Preco invalido/);
    assert.match(fieldError({ name: 'x', price: -1 }, 'price'), /nao pode ser negativo/);
    assert.match(fieldError({ name: 'x', price: 1e10 }, 'price'), /acima do limite/);
  });

  it('completa o link sem protocolo e recusa o que nao for http(s)', () => {
    assert.equal(validateItem({ name: 'x', link: 'amazon.com.br/fone' }).link, 'https://amazon.com.br/fone');
    assert.equal(validateItem({ name: 'x', link: 'https://loja.com/p' }).link, 'https://loja.com/p');
    assert.equal(validateItem({ name: 'x', link: '   ' }).link, null);
    assert.match(fieldError({ name: 'x', link: 'ftp://arquivo.zip' }, 'link'), /http:\/\/ ou https/);
    assert.match(fieldError({ name: 'x', link: '%%%' }, 'link'), /Link invalido/);
  });

  it('aceita prioridade com acento/maiuscula e usa "media" como padrao', () => {
    assert.deepEqual(PRIORITIES, ['baixa', 'media', 'alta']);
    assert.equal(validateItem({ name: 'x', priority: 'Média' }).priority, 'media');
    assert.equal(validateItem({ name: 'x', priority: ' ALTA ' }).priority, 'alta');
    assert.equal(validateItem({ name: 'x' }).priority, 'media');
    assert.match(fieldError({ name: 'x', priority: 'urgente' }, 'priority'), /baixa, media, alta/);
  });

  it('aceita purchased em varias formas', () => {
    for (const truthy of [true, 1, '1', 'sim', 'Sim']) {
      assert.equal(validateItem({ name: 'x', purchased: truthy }).purchased, true, `${truthy}`);
    }
    for (const falsy of [false, 0, '0', 'nao', 'Não']) {
      assert.equal(validateItem({ name: 'x', purchased: falsy }).purchased, false, `${falsy}`);
    }
    assert.equal(validateItem({ name: 'x' }).purchased, false);
    assert.ok(fieldError({ name: 'x', purchased: 'talvez' }, 'purchased'));
  });

  it('limita as observacoes a 2000 caracteres', () => {
    assert.equal(validateItem({ name: 'x', notes: '  preto  ' }).notes, 'preto');
    assert.equal(validateItem({ name: 'x', notes: '' }).notes, null);
    assert.equal(validateItem({ name: 'x' }).notes, null);
    assert.match(fieldError({ name: 'x', notes: 'a'.repeat(2001) }, 'notes'), /no maximo 2000/);
  });

  it('junta todos os erros de uma vez (a interface destaca cada campo)', () => {
    const error = captureError(() => validateItem({ name: '', price: -1, link: 'ftp://x' }));
    assert.deepEqual(Object.keys(error.fields).sort(), ['link', 'name', 'price']);
  });

  it('em atualizacoes parciais valida apenas os campos enviados', () => {
    assert.deepEqual(validateItem({ price: 5 }, { partial: true }), { price: 5 });
    assert.deepEqual(validateItem({ notes: null }, { partial: true }), { notes: null });
    assert.match(captureError(() => validateItem({}, { partial: true })).message, /Nenhum campo valido/);
    assert.match(
      captureError(() => validateItem({ inexistente: 1 }, { partial: true })).message,
      /Nenhum campo valido/,
    );
    // Nome enviado vazio continua sendo erro mesmo em atualizacao.
    assert.ok(captureError(() => validateItem({ name: '' }, { partial: true })).fields.name);
  });

  it('recusa corpo que nao seja um objeto JSON', () => {
    for (const body of [null, undefined, 'texto', 42, []]) {
      assert.match(captureError(() => validateItem(body)).message, /envie um objeto JSON/);
    }
  });
});

describe('CRUD e consultas', () => {
  it('cria item com padroes, timestamps e devolve o registro salvo', () => {
    const item = createItem({ name: 'Fone', price: 'R$ 10,00', priority: 'alta' });

    assert.equal(item.id, 1);
    assert.equal(item.name, 'Fone');
    assert.equal(item.price, 10);
    assert.equal(item.priority, 'alta');
    assert.equal(item.notes, null);
    assert.equal(item.purchased, false);
    assert.equal(item.purchasedAt, null);
    assert.equal(item.createdAt, item.updatedAt);
    assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(getItem(1), item);
    assert.equal(getItem(999), null);
  });

  it('ja marca purchasedAt quando o item nasce comprado', () => {
    const item = createItem({ name: 'Livro', purchased: true });
    assert.equal(item.purchased, true);
    assert.equal(item.purchasedAt, item.createdAt);
  });

  it('atualiza apenas os campos enviados', () => {
    const created = createItem({
      name: 'Fone',
      price: 10,
      link: 'loja.com/f',
      priority: 'alta',
      notes: 'preto',
    });

    const updated = updateItem(created.id, { notes: 'branco' });

    assert.equal(updated.id, created.id);
    assert.equal(updated.notes, 'branco');
    assert.equal(updated.name, 'Fone');
    assert.equal(updated.price, 10);
    assert.equal(updated.link, 'https://loja.com/f');
    assert.equal(updated.priority, 'alta');
    assert.equal(updated.purchased, false);
  });

  it('mantem purchasedAt coerente ao alternar o status', () => {
    const item = createItem({ name: 'Fone' });

    const comprado = updateItem(item.id, { purchased: true });
    assert.equal(comprado.purchased, true);
    assert.ok(comprado.purchasedAt, 'purchasedAt deveria ser preenchido ao comprar');

    // Editar outro campo nao mexe na data da compra.
    const editado = updateItem(item.id, { notes: 'continua comprado' });
    assert.equal(editado.purchasedAt, comprado.purchasedAt);

    const desmarcado = updateItem(item.id, { purchased: false });
    assert.equal(desmarcado.purchased, false);
    assert.equal(desmarcado.purchasedAt, null);
  });

  it('permite limpar campos opcionais com null', () => {
    const item = createItem({ name: 'Fone', price: 10, notes: 'preto' });
    const limpo = updateItem(item.id, { price: null, notes: null });
    assert.equal(limpo.price, null);
    assert.equal(limpo.notes, null);
  });

  it('devolve null para id inexistente e valida o corpo antes de salvar', () => {
    assert.equal(updateItem(999, { name: 'x' }), null);

    const item = createItem({ name: 'Fone' });
    assert.throws(() => updateItem(item.id, { price: -1 }), ValidationError);
  });

  it('remove itens e informa se algo foi removido', () => {
    const item = createItem({ name: 'Fone' });

    assert.equal(deleteItem(item.id), true);
    assert.equal(deleteItem(item.id), false);
    assert.equal(getItem(item.id), null);
  });

  it('busca por nome, observacao e link', () => {
    createItem({ name: 'Fone Bluetooth', notes: 'preto fosco', link: 'loja.com/audio' });
    createItem({ name: 'Cadeira', notes: 'cinza' });

    assert.deepEqual(names(listItems({ search: 'bluetooth' })), ['Fone Bluetooth']);
    assert.deepEqual(names(listItems({ search: 'fosco' })), ['Fone Bluetooth']);
    assert.deepEqual(names(listItems({ search: 'audio' })), ['Fone Bluetooth']);
    assert.deepEqual(names(listItems({ search: 'nada disso' })), []);
    assert.equal(listItems({ search: '   ' }).length, 2);
  });

  it('trata % e _ da busca como texto literal', () => {
    createItem({ name: 'Desconto 100%' });
    createItem({ name: 'Desconto 1000' });
    createItem({ name: 'Produto_a' });
    createItem({ name: 'ProdutoXa' });

    assert.deepEqual(names(listItems({ search: '100%' })), ['Desconto 100%']);
    assert.deepEqual(names(listItems({ search: 'Produto_' })), ['Produto_a']);
  });

  it('filtra por prioridade e por status', () => {
    createItem({ name: 'Alta', priority: 'alta' });
    createItem({ name: 'Media', priority: 'media', purchased: true });
    createItem({ name: 'Baixa', priority: 'baixa' });

    assert.deepEqual(names(listItems({ priority: 'alta' })), ['Alta']);
    assert.deepEqual(names(listItems({ priority: 'Média' })), ['Media']);
    assert.deepEqual(names(listItems({ purchased: 'pending' })).sort(), ['Alta', 'Baixa']);
    assert.deepEqual(names(listItems({ purchased: 'purchased' })), ['Media']);
    assert.equal(listItems({ priority: 'all', purchased: 'all' }).length, 3);

    assert.match(
      captureError(() => listItems({ priority: 'urgente' })).message,
      /Filtro de prioridade invalido/,
    );
    assert.match(
      captureError(() => listItems({ purchased: 'talvez' })).message,
      /Filtro de status invalido/,
    );
  });

  it('ordena por prioridade, nome (sem diferenciar maiusculas) e preco', () => {
    createItem({ name: 'zebra', priority: 'baixa' });
    createItem({ name: 'Alface', priority: 'alta', price: 5 });
    createItem({ name: 'Mesa', priority: 'media' });
    createItem({ name: 'banana', priority: 'alta', price: 50 });

    assert.ok(SORT_OPTIONS.includes('recent'));
    assert.deepEqual(names(listItems({ sort: 'name' })), ['Alface', 'banana', 'Mesa', 'zebra']);

    // Itens sem preco vao para o fim nas duas ordenacoes por preco.
    const maisCaros = listItems({ sort: 'price_desc' });
    assert.deepEqual(names(maisCaros).slice(0, 2), ['banana', 'Alface']);
    assert.ok(maisCaros.slice(2).every((item) => item.price === null));

    const maisBaratos = listItems({ sort: 'price_asc' });
    assert.deepEqual(names(maisBaratos).slice(0, 2), ['Alface', 'banana']);
    assert.ok(maisBaratos.slice(2).every((item) => item.price === null));

    // Empate de prioridade nao tem ordem garantida, entao comparamos so as prioridades.
    assert.deepEqual(
      listItems({ sort: 'priority' }).map((item) => item.priority),
      ['alta', 'alta', 'media', 'baixa'],
    );
    // Ordenacao desconhecida cai no padrao (mais recentes primeiro).
    assert.deepEqual(names(listItems({ sort: 'inventado' })), names(listItems({ sort: 'recent' })));
    assert.deepEqual(names(listItems({ sort: 'oldest' })), ['zebra', 'Alface', 'Mesa', 'banana']);
  });

  it('resume a lista inteira em getStats', () => {
    createItem({ name: 'A', price: 10 });
    createItem({ name: 'B' });
    createItem({ name: 'C', price: 5, purchased: true });

    assert.deepEqual(getStats(), {
      total: 3,
      purchased: 1,
      pending: 2,
      pendingTotal: 10,
      purchasedTotal: 5,
      withoutPrice: 1,
    });
  });
});
