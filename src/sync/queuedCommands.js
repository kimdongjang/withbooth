import { compareBundleNumber, compareProductSaleNumber } from '../utils/productDisplay.js';

// Event settings changes that are saved to the IndexedDB order queue first and
// sent later in the same order as sales. Each one needs a pure reducer here and
// a server receipt so a resend is a no-op: api/pos.js queuedSettingsActions
// (pos_command_receipts) or the artist stock requestId receipts for event products.
export const settingsReducers = {
  reorderProducts(state, { productId, saleNumber, expectedOrder }) {
    const order = state.products.slice().sort(compareProductSaleNumber).map(product => product.id);
    if (!Array.isArray(expectedOrder) || JSON.stringify(expectedOrder) !== JSON.stringify(order)) throw new Error('상품 순서가 변경되었습니다. 새로고침 후 다시 수정해주세요.');
    if (!Number.isInteger(saleNumber) || saleNumber < 1 || saleNumber > order.length || !order.includes(productId)) throw new Error('판매 번호는 현재 상품 수 안의 양의 정수로 입력해주세요.');
    const next = order.filter(id => id !== productId);
    next.splice(saleNumber - 1, 0, productId);
    const position = new Map(next.map((id, index) => [id, index + 1]));
    return { ...state, products: state.products.map(product => ({ ...product, saleNumber: position.get(product.id) })) };
  },
  reorderBundles(state, { bundleId, bundleNumber, expectedOrder }) {
    const order = state.bundles.slice().sort(compareBundleNumber).map(bundle => bundle.id);
    if (!Array.isArray(expectedOrder) || JSON.stringify(expectedOrder) !== JSON.stringify(order)) throw new Error('세트 순서가 변경되었습니다. 새로고침 후 다시 수정해주세요.');
    if (!Number.isInteger(bundleNumber) || bundleNumber < 1 || bundleNumber > order.length || !order.includes(bundleId)) throw new Error('세트 번호는 현재 세트 수 안의 양의 정수로 입력해주세요.');
    const next = order.filter(id => id !== bundleId);
    next.splice(bundleNumber - 1, 0, bundleId);
    const position = new Map(next.map((id, index) => [id, index + 1]));
    return { ...state, bundles: state.bundles.map(bundle => ({ ...bundle, bundleNumber: position.get(bundle.id) })) };
  },
  // New event product with client-chosen IDs (api/lib/artistStock.js registerEventArtistProduct).
  registerEventArtistProduct(state, payload, body) {
    const { productId, inventoryId, name, price, quantity } = payload;
    if (typeof productId !== 'string' || typeof inventoryId !== 'string' || typeof name !== 'string' || !name.trim() || name.trim().length > 100
      || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(quantity) || quantity < 0) throw new Error('상품 이름과 0 이상의 정수 판매가·재고를 입력해주세요.');
    if (state.products.some(product => product.id === productId)) throw new Error('이미 등록된 상품입니다.');
    const top = state.products.reduce((max, product) => Math.max(max, Number(product.saleNumber) || 0), 0);
    const product = { id: productId, inventoryId, productNumber: null, inventoryVersion: 0, saleNumber: top + 1, productCode: productId, name: name.trim(),
      goodsType: String(payload.goodsType ?? name).trim(), vtuberName: String(payload.vtuberName || '').trim(), genre: String(payload.genre || '').trim(), creatorName: body?.localDisplay?.creatorName || '',
      ownerId: payload.ownerId || null, price, stock: quantity, stockQty: quantity, initialStockQty: quantity, imageUrl: null, isActive: true, createdAt: body?.localDisplay?.createdAt || null, pendingSync: true };
    return { ...state, products: [...state.products, product] };
  },
  // Product information and event price. Stock allocation stays online-only.
  saveEventArtistProduct(state, { id, product: patch = {} }, body) {
    const productId = body?.localDisplay?.productId;
    const target = state.products.find(product => productId ? product.id === productId : product.inventoryId === id);
    if (!target) throw new Error('행사 배정 상품을 찾을 수 없습니다.');
    if (!Number.isSafeInteger(patch.price) || patch.price < 0) throw new Error('행사 판매가를 확인해주세요.');
    const values = Object.fromEntries(['name', 'goodsType', 'vtuberName', 'genre', 'price'].filter(key => Object.hasOwn(patch, key)).map(key => [key, patch[key]]));
    return { ...state, products: state.products.map(product => product === target ? { ...product, ...values, pendingSync: true } : product) };
  },
  removeProduct(state, { productId }) {
    if (!state.products.some(product => product.id === productId)) throw new Error('상품을 찾을 수 없습니다.');
    // The server compacts sale numbers of the remaining active products.
    const remaining = state.products.filter(product => product.id !== productId).sort(compareProductSaleNumber);
    const position = new Map(remaining.map((product, index) => [product.id, index + 1]));
    return { ...state, products: state.products.filter(product => product.id !== productId).map(product => ({ ...product, saleNumber: position.get(product.id) })) };
  },
  saveBundle(state, { bundle, expected }) {
    validBundle(bundle);
    const current = state.bundles.find(item => item.id === bundle.id);
    if (!sameBundle(current, expected)) throw new Error('세트가 변경되었습니다. 최신 세트를 확인해주세요.');
    const values = { name: bundle.name, price: bundle.price, items: bundleItems(bundle.items) };
    if (current) return { ...state, bundles: state.bundles.map(item => item.id === bundle.id ? { ...item, ...values } : item) };
    // Provisional number using the server rule (highest + 1); the server's number replaces it after sync.
    const top = state.bundles.reduce((max, item) => Math.max(max, Number(item.bundleNumber) || 0), 0);
    return { ...state, bundles: [...state.bundles, { id: bundle.id, ...values, bundleNumber: top + 1 }] };
  },
  deleteBundle(state, { bundleId, expected }) {
    const current = state.bundles.find(item => item.id === bundleId);
    if (current && !sameBundle(current, expected)) throw new Error('세트가 변경되었습니다. 최신 세트를 확인해주세요.');
    return { ...state, bundles: state.bundles.filter(item => item.id !== bundleId) };
  },
};

export const queuedSettingsActions = Object.keys(settingsReducers);
// Event product commands go to the artist stock API; the rest to the POS API.
export const queuedEndpoint = action => ['registerEventArtistProduct', 'saveEventArtistProduct'].includes(action) ? '/api/booths' : '/api/pos';
export const isQueuedSettings = payload => queuedSettingsActions.includes(payload?.action);

export const bundleItems = items => (items || []).map(item => ({ productId: item.productId, qty: Number(item.qty) }));
export const bundleSnapshot = bundle => bundle ? { name: bundle.name, price: Number(bundle.price), items: bundleItems(bundle.items) } : null;
export function sameBundle(current, expected) {
  if (!current || !expected) return !current && !expected;
  return JSON.stringify(bundleSnapshot(current)) === JSON.stringify(bundleSnapshot(expected));
}
function validBundle(bundle) {
  const ok = bundle && typeof bundle.id === 'string' && bundle.id && typeof bundle.name === 'string' && bundle.name.trim() && Number.isSafeInteger(bundle.price) && bundle.price >= 0
    && Array.isArray(bundle.items) && bundle.items.length && bundle.items.every(item => typeof item.productId === 'string' && item.productId && Number.isSafeInteger(Number(item.qty)) && Number(item.qty) > 0);
  if (!ok) throw new Error('세트 이름, 0원 이상의 정수 판매가, 구성품과 양의 정수 수량을 입력해주세요.');
}

// Whole-list edits from the set screens become per-set commands, so a resend or
// another device's change to a different set is never overwritten.
export function bundleCommands(previous, next) {
  const commands = [];
  for (const bundle of previous) if (!next.some(item => item.id === bundle.id)) commands.push({ action: 'deleteBundle', payload: { bundleId: bundle.id, expected: bundleSnapshot(bundle) } });
  for (const bundle of next) {
    const current = previous.find(item => item.id === bundle.id);
    if (current && sameBundle(current, bundle)) continue;
    commands.push({ action: 'saveBundle', payload: { bundle: { id: bundle.id, name: bundle.name, price: Number(bundle.price), items: bundleItems(bundle.items) }, expected: bundleSnapshot(current) } });
  }
  return commands;
}

export function productsAfterSale(products, cart) {
  const sold = new Map();
  for (const line of cart || []) {
    if (line.type === 'product') sold.set(line.id, (sold.get(line.id) || 0) + Number(line.qty || 0));
    if (line.type === 'bundle') for (const item of line.subItems || []) sold.set(item.productId, (sold.get(item.productId) || 0) + Number(item.qty || 0) * Number(line.qty || 0));
  }
  return products.map(product => ({
    ...product,
    stock: Math.max(0, Number(product.stock || 0) - Number(sold.get(product.id) || 0)),
    stockQty: Math.max(0, Number(product.stockQty ?? product.stock ?? 0) - Number(sold.get(product.id) || 0)),
  }));
}

export function productsAfterVoidSale(products, bundles, sale) {
  const restored = new Map();
  for (const line of sale?.lines || []) {
    if (line.type === 'product') restored.set(line.id, (restored.get(line.id) || 0) + Number(line.qty || 0));
    if (line.type === 'bundle') {
      const bundle = bundles.find(item => item.id === line.id);
      for (const item of line.subItems || bundle?.items || []) restored.set(item.productId, (restored.get(item.productId) || 0) + Number(item.qty || 0) * Number(line.qty || 0));
    }
  }
  return products.map(product => ({
    ...product,
    stock: Number(product.stock || 0) + Number(restored.get(product.id) || 0),
    stockQty: Number(product.stockQty ?? product.stock ?? 0) + Number(restored.get(product.id) || 0),
  }));
}

// Replays one queued API body (sale, cancellation or settings change) on a state.
export function applyQueuedCommand(state, body) {
  const { action, payload = {} } = body || {};
  if (settingsReducers[action]) return settingsReducers[action](state, payload, body);
  if (action === 'finalizeSale') {
    if (state.sales.some(sale => sale.id === payload.localOrderId)) return state;
    return { ...state, products: productsAfterSale(state.products, payload.cart), sales: [...state.sales, { id: payload.localOrderId, time: payload.createdAt, method: payload.method, total: payload.total, lines: payload.cart }] };
  }
  if (action === 'voidSale') {
    const sale = state.sales.find(item => item.id === payload.id);
    if (!sale) return state;
    return { ...state, products: productsAfterVoidSale(state.products, state.bundles, sale), sales: state.sales.filter(item => item.id !== payload.id) };
  }
  return state;
}

// Server state + commands not yet acknowledged, in queue order. A command that
// no longer applies (e.g. a stale order) contributes nothing locally; the
// server decides it when it is sent.
export function rebasePending(serverState, bodies) {
  let state = { ...serverState, products: serverState.products || [], bundles: serverState.bundles || [], sales: serverState.sales || [] };
  for (const body of bodies) {
    try { state = applyQueuedCommand(state, body); } catch { /* left for the server to reject */ }
  }
  return state;
}

