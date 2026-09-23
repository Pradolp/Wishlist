# Lista de Desejos

Aplicação web para manter uma lista de desejos pessoal, com CRUD completo,
busca, filtros e resumo de valores. Feita em **Node.js puro + SQLite embutido**:
nenhuma dependência externa, nenhum `npm install`, nenhum servidor de banco
para instalar.

- Interface em `http://localhost:4173` (abre sozinha ao iniciar)
- Banco de dados em um único arquivo: `data/wishlist.db`
- API REST em `/api/items`, usada pela própria interface

## Requisitos

- **Node.js 22.13+** (testado no 24.21.0). O projeto usa `node:sqlite`, que já
  vem embutido no Node — não é preciso instalar driver de banco.
  - Nas versões 23.0 a 23.3 o módulo ainda exige a flag: `node --experimental-sqlite src/server.js`.
  - No Node 24 o `node:sqlite` é estável e a flag não é mais necessária.

## Como rodar

```bash
npm start            # sobe em http://localhost:4173 e abre o navegador
npm run dev          # igual ao start, mas reinicia ao salvar um arquivo
npm run start:no-open  # sobe sem abrir o navegador
```

Para parar: `Ctrl+C`. O banco é criado automaticamente na primeira execução.

> **Windows:** encerrar o `npm` nem sempre encerra o processo filho do Node e a
> porta fica presa. Se acontecer, descubra o PID com
> `netstat -ano | findstr :4173` e finalize com `taskkill /PID <pid> /F`.

## Funcionalidades

- **CRUD completo** pela interface (modal com validação por campo) e pela API
- **Busca** por nome, link ou observação (com `%` e `_` tratados como texto literal)
- **Filtros** por prioridade e por status (a comprar / comprados)
- **Ordenação**: mais recentes, mais antigos, prioridade, nome (A-Z), maior e menor preço
- **Resumo** da lista: total, a comprar, comprados, soma dos valores pendentes e comprados
- **Preço flexível**: aceita `1.234,56`, `R$ 1.234,56`, `12,50` ou `1234.56`
- **Link flexível**: `amazon.com.br/fone` vira `https://amazon.com.br/fone`
- **Prioridade tolerante**: aceita `média`, `Média`, `ALTA`
- Item comprado guarda a data da compra (`purchasedAt`), limpa ao desmarcar

## Estrutura

```
src/db.js        conexão com o SQLite, PRAGMAs e schema
src/items.js     validação de entrada + regras de CRUD e consultas
src/server.js    servidor HTTP: API REST + arquivos estáticos (startServer/stopServer)
public/          front-end sem build (index.html, styles.css, app.js em módulos ES)
tests/           testes automatizados com node:test (regras + API)
data/            banco local, criado em tempo de execução (não versionado)
```

## API

| Método | Rota | Resposta |
| --- | --- | --- |
| `GET` | `/api/health` | `200` `{ ok, database, items }` |
| `GET` | `/api/items` | `200` `{ items, stats }` |
| `POST` | `/api/items` | `201` `{ item, stats }` |
| `GET` | `/api/items/:id` | `200` `{ item }` |
| `PUT` ou `PATCH` | `/api/items/:id` | `200` `{ item, stats }` (atualização parcial nos dois) |
| `DELETE` | `/api/items/:id` | `200` `{ deleted, stats }` |

Query string de `GET /api/items`:

| Parâmetro | Valores | Padrão |
| --- | --- | --- |
| `search` | texto livre (nome, link, observação) | vazio |
| `priority` | `all`, `baixa`, `media`, `alta` | `all` |
| `purchased` | `all`, `pending`, `purchased` | `all` |
| `sort` | `recent`, `oldest`, `priority`, `name`, `price_desc`, `price_asc` | `recent` |

Erros: `400` validação (com `fields` apontando o erro de cada campo), `400`
identificador ou JSON inválido, `404` item/rota inexistente, `405` método não
permitido, `413` corpo acima de 100 KB, `500` erro interno.

Campos aceitos nos itens:

| Campo | Regra |
| --- | --- |
| `name` | obrigatório na criação, até 120 caracteres, sem espaços nas pontas |
| `price` | número ou texto pt-BR, entre `0` e `1.000.000.000` (2 casas decimais) |
| `link` | `http(s)://`; sem protocolo recebe `https://` |
| `priority` | `baixa`, `media` ou `alta` (padrão `media`) |
| `purchased` | `true/false`, `1/0`, `sim/nao` (padrão `false`) |
| `notes` | até 2000 caracteres |

Exemplos:

```bash
# criar
curl -X POST http://localhost:4173/api/items \
  -H 'Content-Type: application/json' \
  -d '{"name":"Fone Bluetooth","price":"R$ 1.234,56","priority":"alta","link":"amazon.com.br/fone"}'

# listar pendentes de prioridade alta
curl 'http://localhost:4173/api/items?priority=alta&purchased=pending&sort=price_desc'

# marcar como comprado
curl -X PATCH http://localhost:4173/api/items/1 \
  -H 'Content-Type: application/json' -d '{"purchased":true}'

# remover
curl -X DELETE http://localhost:4173/api/items/1
```

## Banco de dados

Tabela `items`:

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `id` | INTEGER | chave primária autoincremental |
| `name` | TEXT | obrigatório |
| `price` | REAL | nulo quando não informado |
| `link` | TEXT | nulo quando não informado |
| `priority` | TEXT | `baixa` \| `media` \| `alta` |
| `purchased` | INTEGER | `0` ou `1` |
| `notes` | TEXT | nulo quando não informado |
| `created_at` / `updated_at` | TEXT | data ISO 8601 em UTC |
| `purchased_at` | TEXT | data da compra, nula se ainda não comprado |

O banco usa `journal_mode = WAL`, `foreign_keys = ON` e `busy_timeout = 5000`,
com índices em `created_at` e `purchased`. A API expõe os campos em camelCase
(`createdAt`) e o banco guarda em snake_case (`created_at`).

## Variáveis de ambiente

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `PORT` | `4173` | porta do servidor |
| `HOST` | `127.0.0.1` | interface de rede (só local por padrão) |
| `WISHLIST_DB` | `data/wishlist.db` | caminho de outro arquivo de banco |
| `WISHLIST_NO_OPEN` | — | `1` evita abrir o navegador ao iniciar |

```bash
PORT=8080 WISHLIST_DB=/tmp/teste.db npm start
```

## Testes

```bash
npm test          # roda tudo uma vez
npm run test:watch  # reexecuta ao salvar
```

São 39 testes com o runner nativo (`node:test`), cobrindo as regras de negócio
(`tests/items.test.js`) e a camada HTTP (`tests/api.test.js`). Cada arquivo roda
contra um **banco temporário** e o servidor de teste sobe em **porta aleatória**
com o navegador desativado, então a suíte não toca no seu `data/wishlist.db`.

## Decisões e limites

- O servidor escuta apenas em `127.0.0.1`, pensado para uso pessoal. Para expor
  na rede, mude `HOST` e **adicione autenticação antes** — a API não tem login.
- `PUT` e `PATCH` fazem a mesma coisa (atualização parcial).
- Sem upload de imagens, sem multiusuário, sem paginação e sem histórico de preços.

## Próximos passos possíveis

- Exportar/importar a lista em CSV ou JSON (backup)
- Categorias/tags e ordenação por categoria
- PWA para consultar a lista offline no celular
- Lembrete/notificação de queda de preço
- Autenticação simples para acesso fora da máquina local
