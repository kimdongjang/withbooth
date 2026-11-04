import * as storageContract from '../api/lib/storageContract.js';
import * as eventAccess from '../api/lib/eventAccess.js';
import * as boothFoundation from '../api/lib/boothFoundation.js';
import * as eventSettlement from '../api/lib/eventSettlement.js';
import * as accountInventory from '../api/lib/accountInventory.js';
import * as defaults from '../api/lib/defaultData.js';
import { hashPassword } from '../api/lib/auth.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import 'fake-indexeddb/auto';
import { applyQueuedCommand, bundleCommands, rebasePending } from '../src/sync/queuedCommands.js';

// Real API handler on an in-memory PostgreSQL; no live database.
async function server() {
  const db = new PGlite();
  await db.exec("CREATE TABLE pos_admins (id TEXT PRIMARY KEY); INSERT INTO pos_admins VALUES ('a'), ('b')");
  const sql = (parts, ...values) => db.query(parts.reduce((query, part, i) => query + (i ? `$${i}` : '') + part, ''), values);
  const context = vm.createContext({ URL, crypto: globalThis.crypto });
  const module = new vm.SourceTextModule(await readFile(new URL('../api/pos.js', import.meta.url), 'utf8'), { context });
  await module.link(specifier => {
    const exports = specifier === '@vercel/postgres' ? { sql: { connect: async () => ({ sql, query: query => db.query(query), release() {} }) } }
      : specifier === './lib/auth.js' ? { hashPassword, assertPostgresConnectionString() {}, requireAuth(req, res) { if (req.adminId) return { id: req.adminId }; res.status(401).json({ error: 'Unauthorized' }); return null; }, validateAdminPassword: async () => true }
      : specifier === './lib/storageContract.js' ? storageContract : specifier === './lib/eventAccess.js' ? eventAccess : specifier === './lib/boothFoundation.js' ? boothFoundation
      : specifier === './lib/accountInventory.js' ? accountInventory : specifier === './lib/eventSettlement.js' ? eventSettlement : defaults;
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  const send = async (body, adminId = 'a') => {
    const result = {};
    await module.namespace.default({ method: body ? 'POST' : 'GET', adminId, query: { projectId: body?.projectId ?? send.event }, body }, {
      status(code) { result.status = code; return this; },
      json(value) { result.body = JSON.parse(JSON.stringify(value)); return this; },
    });
    return result;
  };
  const created = await send({ action: 'createProject', payload: { name: '설정 큐 행사' } });
  send.event = created.body.project.id;
  await send({ action: 'replaceProducts', projectId: send.event, payload: { products: [{ id: 'p1', name: 'P1', price: 1000, stockQty: 10 }, { id: 'p2', name: 'P2', price: 0, stockQty: 10 }] } });
  return { db, send, event: send.event };
}
const command = (event, action, payload, commandId) => ({ projectId: event, action, commandId, payload });

test('queued settings changes apply once per command ID; a resend is a no-op and a changed body is refused', async () => {
  const { db, send, event } = await server();
  try {
    const bundle = { id: 'set-1', name: '세트', price: 900, items: [{ productId: 'p1', qty: 1 }] };
    const first = await send(command(event, 'saveBundle', { bundle, expected: null }, 'cfg_1'));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.bundles.map(b => [b.id, b.bundleNumber, b.price]), [['set-1', 1, 900]]);
    // Response lost: the same command is resent and must not create, renumber or conflict.
    const again = await send(command(event, 'saveBundle', { bundle, expected: null }, 'cfg_1'));
    assert.equal(again.status, 200);
    assert.deepEqual(again.body.bundles, first.body.bundles);
    assert.equal((await send(command(event, 'saveBundle', { bundle: { ...bundle, price: 1 }, expected: null }, 'cfg_1'))).status, 409);

    const order = (await send()).body.products.map(p => p.id);
    const move = { productId: 'p2', saleNumber: 1, expectedOrder: order };
    assert.equal((await send(command(event, 'reorderProducts', move, 'cfg_2'))).status, 200);
    const resent = await send(command(event, 'reorderProducts', move, 'cfg_2'));
    assert.equal(resent.status, 200, 'a resend of an applied reorder succeeds instead of failing its stale order check');
    assert.deepEqual(resent.body.products.map(p => [p.id, p.saleNumber]), [['p2', 1], ['p1', 2]]);

    assert.equal((await send(command(event, 'removeProduct', { productId: 'p2' }, 'cfg_3'))).status, 200);
    assert.equal((await send(command(event, 'removeProduct', { productId: 'p2' }, 'cfg_3'))).status, 200);
    assert.deepEqual((await send()).body.products.map(p => [p.id, p.saleNumber]), [['p1', 1]]);

    assert.equal((await send(command(event, 'saveBundle', { bundle, expected: null }, 'bad id!'))).status, 400);
    assert.equal((await send(command(event, 'replaceProducts', { products: [] }, 'cfg_4'))).status, 400, 'only queueable actions accept a command ID');
    // Commands stay inside their own event: another account cannot replay into it.
    assert.notEqual((await send(command(event, 'deleteBundle', { bundleId: 'set-1', expected: bundle }, 'cfg_5'), 'b')).status, 200);
    assert.equal((await send()).body.bundles.length, 1);
  } finally { await db.close(); }
});

test('another device\'s set change is a final 409 conflict; serialization failures stay retryable', async () => {
  const { db, send, event } = await server();
  try {
    const bundle = { id: 'set-1', name: '세트', price: 900, items: [{ productId: 'p1', qty: 1 }] };
    await send(command(event, 'saveBundle', { bundle, expected: null }, 'cfg_a'));
    // Device B edits the set; device A's queued edit still expects the original.
    await send(command(event, 'saveBundle', { bundle: { ...bundle, name: 'B 수정' }, expected: bundle }, 'cfg_b'));
    const stale = await send(command(event, 'saveBundle', { bundle: { ...bundle, price: 500 }, expected: bundle }, 'cfg_c'));
    assert.equal(stale.status, 409);
    assert.equal(stale.body.retryable, undefined);
    assert.equal((await send(command(event, 'deleteBundle', { bundleId: 'set-1', expected: bundle }, 'cfg_d'))).status, 409);
    assert.equal((await send(command(event, 'saveBundle', { bundle: { ...bundle, id: 'set-1' }, expected: null }, 'cfg_e'))).status, 409, 'a create never overwrites an existing set');
    const state = (await send()).body;
    assert.deepEqual(state.bundles.map(b => [b.name, b.price]), [['B 수정', 900]]);
    // Rejected commands leave no receipt, so nothing was half-applied.
    assert.deepEqual((await db.query('SELECT id FROM pos_command_receipts ORDER BY id')).rows.map(r => r.id), ['cfg_a', 'cfg_b']);
    // A set deleted elsewhere is already gone: deleting it again is not a conflict.
    await send(command(event, 'deleteBundle', { bundleId: 'set-1', expected: state.bundles[0] }, 'cfg_f'));
    assert.equal((await send(command(event, 'deleteBundle', { bundleId: 'set-1', expected: bundle }, 'cfg_g'))).status, 200);
    // The bundle-composition guard is a retryable conflict: the sale is kept, not rejected.
    await send(command(event, 'saveBundle', { bundle: { ...bundle, id: 'set-2' }, expected: null }, 'cfg_h'));
    const sale = { localOrderId: 'sale-x', method: 'cash', total: 900, cart: [{ type: 'bundle', id: 'set-2', name: '세트', unitPrice: 900, qty: 1, subItems: [{ productId: 'p1', qty: 2 }] }] };
    const mismatch = await send({ projectId: event, action: 'finalizeSale', payload: sale });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.retryable, true);
  } finally { await db.close(); }
});

test('a set edit queued before a sale reaches the server first, so the sale matches the new composition', async () => {
  const { db, send, event } = await server();
  try {
    const original = { id: 'set-1', name: '세트', price: 900, items: [{ productId: 'p1', qty: 1 }] };
    await send(command(event, 'saveBundle', { bundle: original, expected: null }, 'cfg_1'));
    const edited = { ...original, items: [{ productId: 'p1', qty: 2 }] };
    const sale = { localOrderId: 'sale-1', method: 'cash', total: 900, cart: [{ type: 'bundle', id: 'set-1', name: '세트', unitPrice: 900, qty: 1, subItems: edited.items }] };
    // Out of order the server refuses the sale (composition mismatch).
    assert.equal((await send({ projectId: event, action: 'finalizeSale', payload: sale })).status, 409);
    // Queue order: edit, then sale.
    assert.equal((await send(command(event, 'saveBundle', { bundle: edited, expected: original }, 'cfg_2'))).status, 200);
    assert.equal((await send({ projectId: event, action: 'finalizeSale', payload: sale })).status, 200);
    const state = (await send()).body;
    assert.equal(state.products.find(p => p.id === 'p1').stockQty, 8);
    assert.equal(state.sales.length, 1);
  } finally { await db.close(); }
});

// ---- Browser queue (fake IndexedDB) ----
const urls = new Map();
function sourceUrl(path) {
  if (urls.has(path)) return urls.get(path);
  let code = ts.transpileModule(readFileSync(new URL(path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  code = code.replace(/from ['"]([^'"]+)['"]/g, (match, name) => {
    if (name === 'dexie') return `from '${import.meta.resolve('dexie')}'`;
    if (!name.startsWith('.')) throw new Error(`Unmapped dependency: ${name}`);
    return `from '${sourceUrl(new URL(`${name}.ts`, new URL(path)).href)}'`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  urls.set(path, url);
  return url;
}
const load = path => import(sourceUrl(new URL(path, import.meta.url).href));
const { db } = await load('../src/database/dexie.ts');
const { stateRepository: states } = await load('../src/database/stateRepository.ts');
const { orderRepository: orders } = await load('../src/database/orderRepository.ts');

const products = [{ id: 'p1', saleNumber: 1, stock: 5, stockQty: 5, price: 1000 }, { id: 'p2', saleNumber: 2, stock: 5, stockQty: 5, price: 0 }];
const bundle = { id: 'set-1', name: '세트', price: 900, items: [{ productId: 'p1', qty: 1 }], bundleNumber: 1 };
const initial = { actorId: 'actor', boothId: 'booth', products, bundles: [bundle], sales: [], dataRevision: null };
const row = (localOrderId, body) => ({ projectId: 'event', actorId: 'actor', boothId: 'booth', localOrderId, createdAt: '2026-11-04T00:00:00Z', syncStatus: 'PENDING', retryCount: 0, lastSyncAt: null,
  payload: { protocolVersion: 2, actorId: 'actor', boothId: 'booth', projectId: 'event', dataRevision: null, ...body } });
const settingsRow = (id, action, payload) => row(id, { action, commandId: id, payload });

async function withNetwork(fetcher, run) {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), previousFetch = globalThis.fetch, warn = console.warn;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, locks: { request: async (_name, _options, callback) => callback({}) } } });
  globalThis.fetch = fetcher; console.warn = () => {};
  try { await db.open(); return await run(); } finally {
    console.warn = warn; globalThis.fetch = previousFetch;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator;
    await db.delete(); await db.open();
  }
}
const respond = (status, body = {}) => ({ ok: status < 400, status, json: async () => body });

test('settings changes and sales share one queue: saved atomically, sent in local order, resent with the same ID', async () => {
  const sent = [];
  let lose = true;
  await withNetwork(async (_url, options) => {
    const body = JSON.parse(options.body); sent.push(body);
    if (lose) throw new Error('response lost');
    return respond(200);
  }, async () => {
    await states.save('event', initial);
    const edit = bundleCommands(initial.bundles, [{ ...bundle, items: [{ productId: 'p1', qty: 2 }] }]);
    assert.deepEqual(edit.map(c => c.action), ['saveBundle']);
    const commands = edit.map((c, i) => settingsRow(`cfg_${i}`, c.action, c.payload));
    const afterEdit = commands.reduce((state, c) => applyQueuedCommand(state, c.payload), initial);
    await states.commitCommands('event', commands, initial, afterEdit);
    const cart = [{ type: 'bundle', id: 'set-1', name: '세트', unitPrice: 900, qty: 1, subItems: afterEdit.bundles[0].items }];
    const sale = row('sale-1', { action: 'finalizeSale', payload: { localOrderId: 'sale-1', method: 'cash', total: 900, cart } });
    const afterSale = applyQueuedCommand(afterEdit, sale.payload);
    await states.commitOrder('event', sale, afterEdit, afterSale);
    assert.equal((await states.get('event')).products[0].stock, 3, 'the edited composition is what the local sale consumed');
    // A stale tab cannot queue a change computed from older data.
    await assert.rejects(states.commitCommands('event', [settingsRow('cfg_stale', 'deleteBundle', { bundleId: 'set-1', expected: bundle })], initial, initial), /다른 탭/);
    assert.equal(await orders.countWaiting('event'), 2);

    const { syncService } = await load('../src/sync/syncService.ts');
    syncService.configure({ projectId: 'event', actorId: 'actor', boothId: 'booth', getAuthToken: () => 'token' });
    await syncService.sync();
    assert.deepEqual(sent.map(b => b.action), ['saveBundle'], 'a lost response stops the queue before the dependent sale');
    lose = false;
    await syncService.sync();
    assert.deepEqual(sent.map(b => b.action), ['saveBundle', 'saveBundle', 'finalizeSale']);
    assert.equal(sent[0].commandId, sent[1].commandId, 'the resend keeps the command ID');
    assert.equal(sent[0].commandId, 'cfg_0');
    assert.equal(await orders.countWaiting('event'), 0);
  });
});

test('a rejected settings change is kept as REJECTED, later commands still go, and the projection rebases on the server', async () => {
  const sent = [];
  let snapshot;
  await withNetwork(async (_url, options) => {
    const body = JSON.parse(options.body); sent.push(body.action);
    if (body.action === 'reorderProducts') return respond(409, { error: '상품 순서가 변경되었습니다.' });
    return respond(200);
  }, async () => {
    await states.save('event', initial);
    const reorder = settingsRow('cfg_r', 'reorderProducts', { productId: 'p2', saleNumber: 1, expectedOrder: ['p1', 'p2'] });
    const reordered = applyQueuedCommand(initial, reorder.payload);
    assert.deepEqual(reordered.products.map(p => [p.id, p.saleNumber]), [['p1', 2], ['p2', 1]]);
    await states.commitCommands('event', [reorder], initial, reordered);
    const cart = [{ type: 'product', id: 'p1', name: 'P1', unitPrice: 1000, qty: 1 }];
    const sale = row('sale-2', { action: 'finalizeSale', payload: { localOrderId: 'sale-2', method: 'cash', total: 1000, cart } });
    const sold = applyQueuedCommand(reordered, sale.payload);
    await states.commitOrder('event', sale, reordered, sold);

    const { syncService } = await load('../src/sync/syncService.ts');
    const unsubscribe = syncService.subscribe(value => { snapshot = value; });
    syncService.configure({ projectId: 'event', actorId: 'actor', boothId: 'booth', getAuthToken: () => 'token' });
    // Keep the sale waiting to check the rebase: fail it transiently once.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => JSON.parse(options.body).action === 'finalizeSale' ? (sent.push('finalizeSale'), respond(500, { error: 'down' })) : realFetch(url, options);
    await syncService.sync();
    unsubscribe();
    assert.deepEqual(sent, ['reorderProducts', 'finalizeSale']);
    assert.deepEqual((await orders.getAll('event')).map(o => o.syncStatus), ['REJECTED', 'FAILED']);
    assert.equal((await orders.getAll('event'))[0].lastError, '상품 순서가 변경되었습니다.');
    assert.equal(snapshot.lastRejection.projectId, 'event');
    assert.equal(snapshot.lastRejection.action, 'reorderProducts');
    assert.equal(await orders.countWaiting('event'), 1, 'a rejected change is not resent or counted as waiting');

    // Server state: original order, another device sold one p2. The queued sale is replayed on top.
    const server = { ...initial, products: [{ ...products[0] }, { ...products[1], stock: 4, stockQty: 4 }], sales: [{ id: 'remote', lines: [] }] };
    const version = await states.queueVersion('event');
    const rebased = await states.rebaseRemote('event', server, version, rebasePending);
    assert.deepEqual(rebased.products.map(p => [p.id, p.saleNumber, p.stock]), [['p1', 1, 4], ['p2', 2, 4]]);
    assert.deepEqual(rebased.sales.map(s => s.id), ['remote', 'sale-2']);
    assert.deepEqual(await states.get('event'), rebased);
    // A server state that already contains the sale (response lost) is not counted twice.
    assert.equal(rebasePending({ ...server, sales: [{ id: 'sale-2' }] }, [sale.payload]).products[0].stock, 5);
    // A queue change during the read keeps the newer local projection.
    await orders.add(settingsRow('cfg_late', 'removeProduct', { productId: 'p2' }));
    assert.equal(await states.rebaseRemote('event', server, version, rebasePending), null);
  });
});

test('serialization conflicts and network failures keep a settings command for resend', async () => {
  const sent = [];
  let status = 409;
  await withNetwork(async (_url, options) => { sent.push(JSON.parse(options.body).commandId); return status === 409 ? respond(409, { error: 'busy', retryable: true }) : respond(status, { error: 'down' }); }, async () => {
    await states.save('event', initial);
    const remove = settingsRow('cfg_x', 'removeProduct', { productId: 'p2' });
    await states.commitCommands('event', [remove, settingsRow('cfg_y', 'deleteBundle', { bundleId: 'set-1', expected: bundle })], initial, rebasePending(initial, [remove.payload]));
    const { syncService } = await load('../src/sync/syncService.ts');
    syncService.configure({ projectId: 'event', actorId: 'actor', boothId: 'booth', getAuthToken: () => 'token' });
    await syncService.sync();
    status = 503; await syncService.sync();
    status = 401; await syncService.sync();
    assert.deepEqual(sent, ['cfg_x', 'cfg_x', 'cfg_x'], 'the first command blocks the next until it is accepted or rejected');
    assert.deepEqual((await orders.getAll('event')).map(o => o.syncStatus), ['FAILED', 'PENDING']);
  });
});

test('set list edits become per-set commands with the previous value; reducers mirror the server rules', () => {
  const second = { id: 'set-2', name: '둘', price: 0, items: [{ productId: 'p2', qty: 1 }], bundleNumber: 2 };
  const commands = bundleCommands([bundle, second], [{ ...second, price: 100 }, { id: 'new', name: '새', price: 0, items: [{ productId: 'p1', qty: '3' }] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [
    { action: 'deleteBundle', payload: { bundleId: 'set-1', expected: { name: '세트', price: 900, items: [{ productId: 'p1', qty: 1 }] } } },
    { action: 'saveBundle', payload: { bundle: { id: 'set-2', name: '둘', price: 100, items: [{ productId: 'p2', qty: 1 }] }, expected: { name: '둘', price: 0, items: [{ productId: 'p2', qty: 1 }] } } },
    { action: 'saveBundle', payload: { bundle: { id: 'new', name: '새', price: 0, items: [{ productId: 'p1', qty: 3 }] }, expected: null } },
  ]);
  assert.deepEqual(bundleCommands([bundle], [{ ...bundle }]), [], 'an unchanged list queues nothing');
  const state = commands.reduce((current, c) => applyQueuedCommand(current, c), { products, bundles: [bundle, second], sales: [] });
  assert.deepEqual(state.bundles.map(b => [b.id, b.bundleNumber, b.price]), [['set-2', 2, 100], ['new', 3, 0]], 'a new set gets the next number provisionally');
  assert.throws(() => applyQueuedCommand(state, { action: 'reorderProducts', payload: { productId: 'p1', saleNumber: 2, expectedOrder: ['p2', 'p1'] } }), /순서/);
  assert.throws(() => applyQueuedCommand(state, { action: 'saveBundle', payload: { bundle: { id: 'x', name: '무료', price: -1, items: [{ productId: 'p1', qty: 1 }] }, expected: null } }), /0원 이상/);
  assert.equal(applyQueuedCommand(state, { action: 'saveBundle', payload: { bundle: { id: 'free', name: '무료', price: 0, items: [{ productId: 'p2', qty: 1 }] }, expected: null } }).bundles.at(-1).price, 0, 'free sets stay allowed');
  const removed = applyQueuedCommand(state, { action: 'removeProduct', payload: { productId: 'p1' } });
  assert.deepEqual(removed.products.map(p => [p.id, p.saleNumber]), [['p2', 1]]);
});

test('set reorder and offline event product registration/edit replay locally; event product commands go to the stock API in queue order', async () => {
  const two = [bundle, { id: 'set-2', name: '둘', price: 0, items: [{ productId: 'p2', qty: 1 }], bundleNumber: 2 }];
  const reordered = applyQueuedCommand({ products, bundles: two, sales: [] }, { action: 'reorderBundles', payload: { bundleId: 'set-2', bundleNumber: 1, expectedOrder: ['set-1', 'set-2'] } });
  assert.deepEqual(reordered.bundles.map(b => [b.id, b.bundleNumber]), [['set-1', 2], ['set-2', 1]]);
  assert.throws(() => applyQueuedCommand(reordered, { action: 'reorderBundles', payload: { bundleId: 'set-2', bundleNumber: 1, expectedOrder: ['set-1', 'set-2'] } }), /세트 순서/);
  const register = { action: 'registerEventArtistProduct', commandId: 'cfg_reg', localDisplay: { creatorName: '작가', createdAt: '2026-11-04T00:00:00Z' },
    payload: { boothId: 'booth', projectId: 'event', ownerId: 'owner', name: ' 새 상품 ', price: 0, quantity: 3, requestId: 'r', inventoryId: 'inv-new', productId: 'prod-new' } };
  const registered = applyQueuedCommand({ products, bundles: [], sales: [] }, register);
  const created = registered.products.at(-1);
  assert.deepEqual([created.id, created.inventoryId, created.name, created.price, created.stockQty, created.saleNumber, created.creatorName, created.pendingSync], ['prod-new', 'inv-new', '새 상품', 0, 3, 3, '작가', true], 'free products stay allowed');
  const sold = applyQueuedCommand(registered, { action: 'finalizeSale', payload: { localOrderId: 's', cart: [{ type: 'product', id: 'prod-new', qty: 1, unitPrice: 0 }], method: 'cash', total: 0 } });
  assert.equal(sold.products.at(-1).stockQty, 2, 'a sale queued after the offline registration uses its client ID');
  const edit = { action: 'saveEventArtistProduct', localDisplay: { productId: 'prod-new' }, payload: { id: 'inv-new', projectId: 'event', latest: true, product: { name: '수정', goodsType: '키링', vtuberName: '', genre: '', price: 500 } } };
  assert.deepEqual([applyQueuedCommand(sold, edit).products.at(-1).name, applyQueuedCommand(sold, edit).products.at(-1).price], ['수정', 500]);
  // Server already has the registration (response lost): replay does not add a duplicate.
  const server = { products: [...products, { ...created, pendingSync: undefined }], bundles: [], sales: [] };
  assert.equal(rebasePending(server, [register, edit]).products.filter(p => p.id === 'prod-new').length, 1);

  const calls = [];
  await withNetwork(async (url, options) => { calls.push([url, JSON.parse(options.body).action]); return respond(200); }, async () => {
    await states.save('event', initial);
    const rows = [{ ...settingsRow('cfg_reg', 'registerEventArtistProduct', register.payload), endpoint: '/api/booths' }];
    await states.commitCommands('event', rows, initial, initial);
    await orders.add(row('sale-new', { action: 'finalizeSale', payload: { localOrderId: 'sale-new', cart: [] } }));
    const { syncService } = await load('../src/sync/syncService.ts');
    syncService.configure({ projectId: 'event', actorId: 'actor', boothId: 'booth', getAuthToken: () => 'token' });
    await syncService.sync();
    assert.deepEqual(calls, [['/api/booths', 'registerEventArtistProduct'], ['/api/pos', 'finalizeSale']]);
  });
});
