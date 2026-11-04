import { useEffect, useRef, useState } from 'react';
import { PageIntro, PageTabs } from '../components/PageLayout';
import { useProductReorder } from '../hooks/useProductReorder';
import { ItemButton } from '../components/PosUI';
import { won, productNameWithoutCreator, eventCreatorNameOf } from '../utils/productDisplay';

export default function SalesPage({ project, products = [], readOnly, purchaseTab, setPurchaseTab, visibleProducts, visibleBundles, creators, creatorFilter, setCreatorFilter, availableStock, bundleAvailable, addProduct, addBundle, cart, setCart, orderExpanded, setOrderExpanded, total, updateCartQty, saving, finalizeSale, canReorder, onReorder, onReorderBundles }) {
  const [sorting, setSorting] = useState(false);
  const sortActive = sorting && canReorder;
  const reorder = useProductReorder({ products: visibleProducts, disabled: !sortActive || purchaseTab !== 'products' || readOnly || saving || creatorFilter !== 'all', onSave: onReorder });
  // Sets reuse the same drag/keyboard ordering; the hook's position becomes the set purchase number.
  const bundleReorder = useProductReorder({ products: visibleBundles, disabled: !sortActive || purchaseTab !== 'bundles' || readOnly || saving || creatorFilter !== 'all' || !onReorderBundles, onSave: ({ productId, saleNumber, expectedOrder }) => onReorderBundles({ bundleId: productId, bundleNumber: saleNumber, expectedOrder }) });
  const [payment, setPayment] = useState(null);
  const dialogRef = useRef(null);
  const submitting = useRef(false);
  const validPayment = payment && payment.cart === cart && payment.total === total && payment.projectId === project?.id && !readOnly && !saving && cart.length > 0;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!validPayment) { setPayment(null); return; }
    dialog.showModal();
    return () => dialog.close();
  }, [validPayment]);
  const requestPayment = method => {
    if (readOnly || saving || !cart.length || submitting.current) return;
    setPayment({ method, cart, total, projectId: project?.id });
  };
  const confirmPayment = async () => {
    if (!validPayment || submitting.current) return;
    submitting.current = true;
    setPayment(null);
    try { await finalizeSale(payment.method); }
    finally { submitting.current = false; }
  };
  return <main className="pos-layout flex min-h-0 flex-1 gap-5 p-5">
      <section className="catalog min-w-0 flex-1 overflow-y-auto">
        <PageIntro hideTitle title="상품 판매">
          <div className="sales-tabs-row">
            <PageTabs id="purchase" label="구매 방식" tabs={[["products", "단품 구매"], ["bundles", "세트 구매"]]} selected={purchaseTab} onSelect={setPurchaseTab} />
            {canReorder && <label className="sort-mode-toggle"><input type="checkbox" checked={sortActive} onChange={() => { setSorting(!sortActive); if (!sortActive) setCreatorFilter('all'); }} />순서 변경</label>}
          </div>
        </PageIntro>
        <div className="catalog-filters" role="group" aria-label="제작자 필터">
          <span className="filter-label">제작자</span>
          <div className="filter-options">
            <button type="button" disabled={sortActive} aria-pressed={creatorFilter === 'all'} onClick={() => setCreatorFilter('all')}>전체</button>
            {creators.map((creator) => <button key={creator} type="button" disabled={sortActive} aria-pressed={creatorFilter === creator} onClick={() => setCreatorFilter(creator)}>{creator}</button>)}
          </div>
        </div>
        <div id={`purchase-panel-${purchaseTab}`} role="tabpanel" aria-labelledby={`purchase-tab-${purchaseTab}`} tabIndex={0}>
          {purchaseTab === 'products' ? <div className="product-grid grid gap-3" data-reorder-root>{reorder.message && <p role="alert" className="product-reorder-error col-span-full">{reorder.message}</p>}{visibleProducts.map((p, i) => sortActive ? <div key={p.id} className="sort-card" {...reorder.rowProps(p, i)}><ItemButton saleNumber={p.saleNumber || i + 1} imageUrl={p.imageUrl} soldout={false} stock={`남음 ${availableStock(p)}`} name={productNameWithoutCreator(p)} price={p.price} creatorName={eventCreatorNameOf(p)} onClick={() => {}} /><button className="sort-card-handle" {...reorder.handleProps(p)} /></div> : <ItemButton key={p.id} saleNumber={p.saleNumber || i + 1} imageUrl={p.imageUrl} soldout={availableStock(p) <= 0} locked={readOnly} stock={`남음 ${availableStock(p)}`} name={productNameWithoutCreator(p)} price={p.price} creatorName={eventCreatorNameOf(p)} onClick={() => addProduct(p)} />)}</div> : <div className="product-grid grid gap-3" data-reorder-root>{bundleReorder.message && <p role="alert" className="product-reorder-error col-span-full">{bundleReorder.message}</p>}{visibleBundles.map((b, i) => sortActive ? <div key={b.id} className="sort-card" {...bundleReorder.rowProps(b, i)}><ItemButton bundle saleNumber={b.bundleNumber || i + 1} soldout={false} stock={`가능 ${bundleAvailable(b)}`} name={b.name} components={b.items.map(item => { const product = products.find(p => p.id === item.productId); return [product ? productNameWithoutCreator(product) : '삭제된 상품', item.qty]; })} price={b.price} onClick={() => {}} /><button className="sort-card-handle" {...bundleReorder.handleProps(b)} /></div> : <ItemButton key={b.id} bundle saleNumber={b.bundleNumber || i + 1} soldout={bundleAvailable(b) <= 0} locked={readOnly} stock={bundleAvailable(b) <= 0 ? '품절' : `가능 ${bundleAvailable(b)}`} name={b.name} components={b.items.map(item => { const product = products.find(p => p.id === item.productId); return [product ? productNameWithoutCreator(product) : '삭제된 상품', item.qty]; })} price={b.price} onClick={() => addBundle(b)} />)}</div>}
          {!(purchaseTab === 'products' ? visibleProducts.length : visibleBundles.length) && <p className="catalog-empty">{creatorFilter !== 'all' ? `선택한 제작자의 ${purchaseTab === 'products' ? '상품' : '세트'}가 없습니다.` : purchaseTab === 'products' ? '등록된 상품이 없습니다.' : '등록된 세트가 없습니다.'}</p>}
        </div>
      </section>
      <aside className="order-panel flex shrink-0 flex-col rounded-2xl border border-line bg-white text-ink">
        <div className="order-summary"><div><div className="flex items-center gap-2"><h2 className="text-sm font-bold">현재 주문</h2><span className="text-xs text-slate-500">{cart.reduce((count, line) => count + line.qty, 0)}개</span></div><button type="button" className="order-detail-toggle" aria-expanded={orderExpanded} aria-controls="order-lines" onClick={() => setOrderExpanded(!orderExpanded)}>{orderExpanded ? '주문 접기 ∨' : '주문 상세 ∧'}</button></div><div className="text-right"><div className="text-xs text-slate-500">결제할 금액</div><div className="order-total mono font-bold text-register" aria-live="polite">{won(total)}<span className="ml-1 text-sm text-slate-500">원</span></div></div></div>
        <div id="order-lines" className={`order-lines flex-1 overflow-y-auto px-3 py-1.5 ${orderExpanded ? 'is-expanded' : ''}`}>{cart.length ? cart.map((line, i) => <div key={`${line.type}-${line.id}`} className="flex items-center gap-2 border-b border-line px-1.5 py-2.5"><div className="flex-1 text-[13.5px]">{line.type === 'bundle' && <span className="mr-1 rounded bg-amber-pos px-1.5 py-0.5 text-[9px] text-white">SET</span>}{line.name}{line.type === 'bundle' && line.subItems?.length > 0 && <ul className="order-bundle-items" aria-label={`${line.name} 구성품`}>{line.subItems.map((item, index) => { const product = products.find(p => p.id === item.productId); return <li key={`${item.productId}-${index}`}><span>{product ? productNameWithoutCreator(product) : '삭제된 상품'}</span><span className="mono">×{item.qty * line.qty}</span></li>; })}</ul>}<div className="text-xs text-[#64748b]">{won(line.unitPrice)}원</div></div><button className="h-9 w-9 shrink-0 rounded-lg border border-line bg-paper" aria-label={`${line.name} 수량 줄이기`} onClick={() => updateCartQty(i, -1)}>−</button><span className="w-5 text-center text-sm">{line.qty}</span><button className="h-9 w-9 shrink-0 rounded-lg border border-line bg-paper" aria-label={`${line.name} 수량 늘리기`} onClick={() => updateCartQty(i, 1)}>+</button><div className="mono w-[70px] text-right text-[13.5px] font-bold">{won(line.unitPrice * line.qty)}</div><button aria-label={`${line.name} 주문에서 제거`} className="h-9 w-9 shrink-0 text-[#dc2626]" onClick={() => setCart(cart.filter((_, idx) => idx !== i))}>✕</button></div>) : <div className="px-5 py-10 text-center text-sm text-[#64748b]">굿즈를 선택해주세요</div>}</div>
        <div className="order-actions border-t border-line p-3.5"><div className="flex gap-2.5"><button disabled={readOnly || !cart.length || saving} onClick={() => requestPayment('cash')} className="flex-1 rounded-2xl bg-cash px-2 py-4 font-bold text-white disabled:bg-slate-200 disabled:text-slate-500">현금 결제</button><button disabled={readOnly || !cart.length || saving} onClick={() => requestPayment('transfer')} className="flex-1 rounded-2xl bg-transfer px-2 py-4 font-bold text-white disabled:bg-slate-200 disabled:text-slate-500">계좌이체</button></div><button onClick={() => cart.length && confirm('장바구니를 비울까요?') && setCart([])} className="mt-2 w-full rounded-lg border border-line py-2 text-xs text-[#526078]">비우기</button></div>
      </aside>
      {sortActive && reorder.state?.grab && (() => { const p = visibleProducts.find(item => item.id === reorder.state.id); const i = visibleProducts.indexOf(p); return p && <div className="sort-ghost" aria-hidden="true" style={{ left: reorder.state.point.x - reorder.state.grab.x, top: reorder.state.point.y - reorder.state.grab.y, width: reorder.state.grab.width, height: reorder.state.grab.height }}><ItemButton saleNumber={p.saleNumber || i + 1} imageUrl={p.imageUrl} soldout={false} stock={`남음 ${availableStock(p)}`} name={productNameWithoutCreator(p)} price={p.price} creatorName={eventCreatorNameOf(p)} onClick={() => {}} /></div>; })()}
      <dialog ref={dialogRef} className="payment-confirm-dialog" aria-labelledby="payment-confirm-title" aria-describedby="payment-confirm-description" onCancel={event => { event.preventDefault(); setPayment(null); }}>
        <div className="payment-confirm-content">
          <span className="payment-confirm-icon" aria-hidden="true">?</span>
          <div><h2 id="payment-confirm-title">결제하시겠습니까?</h2><p id="payment-confirm-description">{payment?.method === 'cash' ? '현금' : '계좌이체'} · {won(payment?.total ?? total)}원</p></div>
        </div>
        <div className="payment-confirm-actions"><button type="button" autoFocus onClick={() => setPayment(null)}>취소</button><button type="button" className="payment-confirm-ok" disabled={!validPayment} onClick={confirmPayment}>결제하기</button></div>
      </dialog>
    </main>;
}
