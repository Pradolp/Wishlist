/**
 * Interface da Lista de Desejos.
 * Conversa com a API REST em /api/items (ver src/server.js).
 */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const PRIORITY_LABELS = { baixa: 'Baixa', media: 'Media', alta: 'Alta' };

const state = {
  items: [],
  stats: null,
  filters: { search: '', priority: 'all', purchased: 'all', sort: 'recent' },
  editingId: null,
  loading: true,
};

/* ------------------------------------------------------------------ *
 * Utilitarios
 * ------------------------------------------------------------------ */

/** Cria elementos do DOM sem innerHTML (evita injecao de HTML pelo conteudo do usuario). */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatMoney(value) {
  return value === null || value === undefined ? 'Sem preco' : money.format(value);
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function toast(message, type = 'info') {
  const node = el('div', { class: `toast ${type}`, text: message });
  $('#toasts').append(node);
  setTimeout(() => node.remove(), type === 'error' ? 6000 : 3500);
}

/* ------------------------------------------------------------------ *
 * Cliente da API
 * ------------------------------------------------------------------ */

async function api(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const error = new Error('Nao foi possivel falar com o servidor. Ele ainda esta rodando?');
    error.offline = true;
    throw error;
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(payload?.error ?? `Erro ${response.status}`);
    error.fields = payload?.fields ?? {};
    error.status = response.status;
    throw error;
  }
  return payload;
}

/* ------------------------------------------------------------------ *
 * Carregamento e renderizacao
 * ------------------------------------------------------------------ */

async function load({ silent = false } = {}) {
  if (!silent) {
    state.loading = true;
    renderEmpty();
  }

  const params = new URLSearchParams();
  if (state.filters.search) params.set('search', state.filters.search);
  if (state.filters.priority !== 'all') params.set('priority', state.filters.priority);
  if (state.filters.purchased !== 'all') params.set('purchased', state.filters.purchased);
  params.set('sort', state.filters.sort);

  try {
    const { items, stats } = await api('GET', `/api/items?${params}`);
    state.items = items;
    state.stats = stats;
    state.loading = false;
    render();
  } catch (error) {
    state.loading = false;
    renderEmpty(error);
  }
}

function render() {
  renderStats();
  renderSubtitle();
  renderItems();
}

function renderSubtitle() {
  const stats = state.stats;
  const subtitle = $('#subtitle');

  if (!stats || stats.total === 0) {
    subtitle.textContent = 'Nenhum item cadastrado ainda';
    return;
  }
  const filtered = state.items.length !== stats.total;
  subtitle.textContent = filtered
    ? `Mostrando ${state.items.length} de ${stats.total} desejos`
    : `${pluralize(stats.total, 'desejo cadastrado', 'desejos cadastrados')}`;
}

function renderStats() {
  const container = $('#stats');
  container.replaceChildren();

  if (!state.stats || state.stats.total === 0) return;
  const stats = state.stats;

  const cards = [
    { label: 'A comprar', value: String(stats.pending), accent: 'stat-accent' },
    { label: 'Ja comprados', value: String(stats.purchased), accent: 'stat-success' },
    { label: 'Valor a gastar', value: formatMoney(stats.pendingTotal), accent: '' },
    { label: 'Total investido', value: formatMoney(stats.purchasedTotal), accent: '' },
  ];

  container.append(
    ...cards.map((card) =>
      el('div', { class: `stat ${card.accent}` }, [
        el('p', { class: 'stat-label', text: card.label }),
        el('p', { class: 'stat-value', text: card.value }),
      ]),
    ),
  );
}

function renderItems() {
  const list = $('#items');
  const empty = $('#empty');
  list.replaceChildren();

  if (state.items.length === 0) {
    empty.hidden = false;
    renderEmpty();
    return;
  }

  empty.hidden = true;
  list.append(...state.items.map(itemCard));
}

function renderEmpty(error = null) {
  const empty = $('#empty');
  const list = $('#items');
  empty.hidden = false;
  list.replaceChildren();

  if (state.loading) {
    empty.replaceChildren(el('p', { class: 'loading', text: 'Carregando sua lista...' }));
    return;
  }

  if (error) {
    empty.replaceChildren(
      el('strong', { text: 'Deu algo errado' }),
      el('p', { text: error.message }),
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: 'Tentar de novo',
        onclick: () => load(),
      }),
    );
    return;
  }

  const hasFilters =
    state.filters.search ||
    state.filters.priority !== 'all' ||
    state.filters.purchased !== 'all';

  if (hasFilters) {
    empty.replaceChildren(
      el('strong', { text: 'Nenhum item encontrado' }),
      el('p', { text: 'Tente outro termo de busca ou limpe os filtros.' }),
      el('button', {
        class: 'btn btn-ghost',
        type: 'button',
        text: 'Limpar filtros',
        onclick: clearFilters,
      }),
    );
    return;
  }

  empty.replaceChildren(
    el('strong', { text: 'Sua lista esta vazia' }),
    el('p', { text: 'Anote aqui tudo o que voce quer comprar um dia.' }),
    el('button', {
      class: 'btn btn-primary',
      type: 'button',
      text: '+ Adicionar o primeiro desejo',
      onclick: () => openForm(),
    }),
  );
}

function itemCard(item) {
  const classes = ['card', `prio-${item.priority}`];
  if (item.purchased) classes.push('is-purchased');

  const checkbox = el('input', {
    type: 'checkbox',
    checked: item.purchased,
    'aria-label': item.purchased
      ? `Marcar ${item.name} como nao comprado`
      : `Marcar ${item.name} como comprado`,
    onchange: () => togglePurchased(item),
  });

  const meta = el('div', { class: 'card-meta' }, [
    el('span', {
      text: item.purchased && item.purchasedAt
        ? `Comprado em ${formatDate(item.purchasedAt)}`
        : `Adicionado em ${formatDate(item.createdAt)}`,
    }),
  ]);

  if (item.link) {
    meta.append(
      el('a', {
        href: item.link,
        target: '_blank',
        rel: 'noopener noreferrer',
        text: 'Abrir link',
      }),
    );
  }

  const body = el('div', { class: 'card-body' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: item.name }),
      el('span', { class: `badge prio-${item.priority}`, text: PRIORITY_LABELS[item.priority] }),
    ]),
    el('p', { class: 'card-price', text: formatMoney(item.price) }),
    item.notes ? el('p', { class: 'card-notes', text: item.notes }) : null,
    meta,
  ]);

  const actions = el('div', { class: 'card-actions' }, [
    el('button', {
      class: 'btn btn-ghost',
      type: 'button',
      text: 'Editar',
      onclick: () => openForm(item),
    }),
    el('button', {
      class: 'btn btn-danger-ghost',
      type: 'button',
      text: 'Excluir',
      onclick: () => removeItem(item),
    }),
  ]);

  return el('li', { class: classes.join(' '), dataset: { id: String(item.id) } }, [
    el('div', { class: 'card-check' }, [checkbox]),
    body,
    actions,
  ]);
}

/* ------------------------------------------------------------------ *
 * Acoes do CRUD
 * ------------------------------------------------------------------ */

async function togglePurchased(item) {
  try {
    await api('PUT', `/api/items/${item.id}`, { purchased: !item.purchased });
    await load({ silent: true });
    toast(
      item.purchased ? `"${item.name}" voltou para a lista` : `"${item.name}" marcado como comprado!`,
      'success',
    );
  } catch (error) {
    toast(error.message, 'error');
    await load({ silent: true });
  }
}

async function removeItem(item) {
  const confirmed = window.confirm(`Excluir "${item.name}" da sua lista?`);
  if (!confirmed) return;

  try {
    await api('DELETE', `/api/items/${item.id}`);
    await load({ silent: true });
    toast(`"${item.name}" foi excluido.`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ *
 * Modal de cadastro / edicao
 * ------------------------------------------------------------------ */

const dialog = $('#dialog');
const form = $('#form');

function clearErrors() {
  $('#form-errors').hidden = true;
  $('#form-errors').textContent = '';
  for (const hint of $$('.hint.error')) {
    hint.hidden = true;
    hint.textContent = '';
  }
  for (const field of $$('.field.has-error')) field.classList.remove('has-error');
}

function showFieldErrors(fields = {}) {
  const unknown = [];

  for (const [key, message] of Object.entries(fields)) {
    const hint = $(`[data-error-for="${key}"]`);
    if (!hint) {
      unknown.push(message);
      continue;
    }
    hint.textContent = message;
    hint.hidden = false;
    hint.closest('.field')?.classList.add('has-error');
  }

  if (unknown.length > 0) {
    const box = $('#form-errors');
    box.textContent = unknown.join(' ');
    box.hidden = false;
  }
}

function openForm(item = null) {
  state.editingId = item?.id ?? null;
  clearErrors();
  form.reset();

  $('#dialog-title').textContent = item ? 'Editar desejo' : 'Novo desejo';
  $('#btn-save').textContent = item ? 'Salvar alteracoes' : 'Adicionar';

  if (item) {
    form.elements.name.value = item.name;
    form.elements.price.value = item.price ?? '';
    form.elements.link.value = item.link ?? '';
    form.elements.notes.value = item.notes ?? '';
    form.elements.priority.value = item.priority;
    form.elements.purchased.checked = item.purchased;
  }

  dialog.showModal();
  form.elements.name.focus();
}

function closeForm() {
  if (dialog.open) dialog.close();
  state.editingId = null;
  clearErrors();
}

async function submitForm(event) {
  event.preventDefault();
  clearErrors();

  const payload = {
    name: form.elements.name.value,
    price: form.elements.price.value === '' ? null : Number(form.elements.price.value),
    link: form.elements.link.value,
    notes: form.elements.notes.value,
    priority: form.elements.priority.value,
    purchased: form.elements.purchased.checked,
  };

  const saveButton = $('#btn-save');
  saveButton.disabled = true;

  try {
    if (state.editingId === null) {
      const { item } = await api('POST', '/api/items', payload);
      closeForm();
      await load({ silent: true });
      toast(`"${item.name}" foi adicionado a lista.`, 'success');
    } else {
      const { item } = await api('PUT', `/api/items/${state.editingId}`, payload);
      closeForm();
      await load({ silent: true });
      toast(`"${item.name}" foi atualizado.`, 'success');
    }
  } catch (error) {
    showFieldErrors(error.fields);
    if (!error.fields || Object.keys(error.fields).length === 0) {
      const box = $('#form-errors');
      box.textContent = error.message;
      box.hidden = false;
    }
    toast(error.message, 'error');
  } finally {
    saveButton.disabled = false;
  }
}

/* ------------------------------------------------------------------ *
 * Eventos
 * ------------------------------------------------------------------ */

function clearFilters() {
  state.filters = { search: '', priority: 'all', purchased: 'all', sort: state.filters.sort };
  $('#search').value = '';
  $('#filter-priority').value = 'all';
  $('#filter-purchased').value = 'all';
  load({ silent: true });
}

let searchTimer;
$('#search').addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  const value = event.target.value;
  searchTimer = setTimeout(() => {
    state.filters.search = value.trim();
    load({ silent: true });
  }, 250);
});

$('#filter-priority').addEventListener('change', (event) => {
  state.filters.priority = event.target.value;
  load({ silent: true });
});

$('#filter-purchased').addEventListener('change', (event) => {
  state.filters.purchased = event.target.value;
  load({ silent: true });
});

$('#sort').addEventListener('change', (event) => {
  state.filters.sort = event.target.value;
  load({ silent: true });
});

$('#btn-new').addEventListener('click', () => openForm());
$('#btn-close').addEventListener('click', closeForm);
$('#btn-cancel').addEventListener('click', closeForm);
form.addEventListener('submit', submitForm);

// Fecha ao clicar fora do modal.
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) closeForm();
});

// Atalhos: "n" abre o formulario, Ctrl+Enter salva.
document.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (event.key === 'n' && !typing && !dialog.open) {
    event.preventDefault();
    openForm();
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && dialog.open) {
    event.preventDefault();
    form.requestSubmit();
  }
});

load();
