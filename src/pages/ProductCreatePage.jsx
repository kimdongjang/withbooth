import CreatorField from '../components/CreatorField';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { useEffect, useRef, useState } from 'react';
import { uploadProductImage } from '../utils/uploadProductImage';
import { PageIntro } from '../components/PageLayout';
import { Input, ProductImage } from '../components/PosUI';
import InventoryProductFields from '../components/InventoryProductFields';
import { prepareProductImage } from '../utils/productImage';
import { uid } from '../utils/productDisplay';

export default function ProductCreatePage({ projectId, onImageChange, readOnly, saving, products, registerProduct, onBack, artists, saveImage, allowDirectArtist = false,creatorRequest,creatorProject,onRefreshCreators,fixedCreator,loadCreatorStock,onAllocateStock,onSaveStockProduct }) {
  const pendingKey = `pos_event_product_registration:${artists ? 'artist:' : ''}${projectId}`;
  const pending = useRef(null);
  const [draft, setDraft] = useState(() => {
    try { pending.current = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); } catch { /* Keep unreadable storage untouched. */ }
    return pending.current || { id: artists ? crypto.randomUUID() : uid(), name: '', goodsType: '', vtuberName: '', creatorName: '', genre: '', price: 1000, stockQty: 0 };
  });
  const original = useRef(JSON.stringify(draft));
  const [uncertain, setUncertain] = useState(Boolean(pending.current));
  const [image, setImage] = useState(null);
  const clearUnsaved = useUnsavedChanges(JSON.stringify(draft) !== original.current || Boolean(image));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [creatorBusy,setCreatorBusy]=useState(false);
  const [preparing, setPreparing] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [imageError, setImageError] = useState('');
  const submitting = useRef(false);
  const imageChange = useRef(onImageChange);
  imageChange.current = onImageChange;
  const uploadedImage = useRef(null);
  const savedProduct = useRef(false);
  // Selecting one of the creator's existing stock items registers it by allocating that stock to this event.
  const [stockId, setStockId] = useState('');
  const [stockQty, setStockQty] = useState('0');
  const [stockPrice, setStockPrice] = useState('0');
  const fixedOwnerId = fixedCreator?.ownerId;
  useEffect(() => {
    if (fixedOwnerId) setDraft(current => current.ownerId === fixedOwnerId ? current : { ...current, ownerId: fixedOwnerId, artistName: '', creatorName: fixedCreator.label || '' });
  }, [fixedOwnerId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The selected creator's stock is read directly, so creators outside the event catalog (e.g. the operator) are included.
  const [stockLoad, setStockLoad] = useState({ ownerId: '', items: [], error: '' });
  const stockLoader = useRef(loadCreatorStock);
  stockLoader.current = loadCreatorStock;
  const canLoadStock = Boolean(loadCreatorStock);
  useEffect(() => {
    if (!stockLoader.current || !draft.ownerId) { setStockLoad({ ownerId: '', items: [], error: '' }); return; }
    let active = true;
    setStockLoad({ ownerId: draft.ownerId, items: [], error: '', loading: true });
    Promise.resolve(stockLoader.current(draft.ownerId)).then(items => { if (active) setStockLoad({ ownerId: draft.ownerId, items: items || [], error: '' }); })
      .catch(error => { if (active) setStockLoad({ ownerId: draft.ownerId, items: [], error: error.message || '제작자 재고를 불러오지 못했습니다.' }); });
    return () => { active = false; };
  }, [draft.ownerId, canLoadStock]);
  const creatorStock = stockLoad.ownerId === draft.ownerId ? stockLoad.items.filter(item => !item.pendingSync && !(item.allocations || []).some(row => row.projectId === projectId)) : [];
  const stockItem = creatorStock.find(item => item.id === stockId);
  // Name·character·type·series of the picked stock item, editable before registering.
  const [stockInfo, setStockInfo] = useState(null);
  const infoOf = item => ({ name: item?.name || '', vtuberName: item?.vtuberName || '', goodsType: item?.goodsType || '', genre: item?.genre || '' });
  const chooseStock = id => {
    const item = creatorStock.find(row => row.id === id);
    setStockId(id);
    setStockInfo(item ? infoOf(item) : null);
    setStockQty(String(item ? Math.max(0, Number(item.warehouse) || 0) : 0));
    setStockPrice(String(item?.price ?? 0));
    setImageError('');
  };
  useEffect(() => {
    if (!image) { setPreview(null); return; }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const chooseImage = async (file) => {
    if (!file) return;
    setPreparing(true);
    try {
      setImage(await prepareProductImage(file));
      setImageError('');
    } catch (error) { alert(error.message); }
    finally { setPreparing(false); }
  };
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const allocateStock = async () => {
    const quantity = Number(stockQty), price = Number(stockPrice);
    if (!stockInfo?.name.trim()) return alert('상품 이름을 입력해주세요.');
    if (stockQty === '' || stockPrice === '' || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > (Number(stockItem.warehouse) || 0) || !Number.isSafeInteger(price) || price < 0 || price > 2147483647) return alert('미배정 재고 이내의 배정 수량과 0 이상의 정수 판매가를 입력해주세요.');
    submitting.current = true;
    setBusy(true);
    setImageError('');
    try {
      let target = stockItem;
      const info = { name: stockInfo.name.trim(), vtuberName: stockInfo.vtuberName.trim(), goodsType: stockInfo.goodsType.trim(), genre: stockInfo.genre.trim() };
      if (onSaveStockProduct && JSON.stringify(info) !== JSON.stringify(infoOf(stockItem))) {
        // Save edited info first; keep the saved version so a retry of the allocation does not re-save.
        const result = await onSaveStockProduct(stockItem, info);
        target = { ...stockItem, ...info, ...(result?.inventory || { version: stockItem.version + 1 }), id: stockItem.id };
        setStockLoad(current => ({ ...current, items: current.items.map(row => row.id === stockItem.id ? target : row) }));
      }
      await onAllocateStock(target, { quantity, price });
      clearUnsaved();
      onBack();
    } catch (error) {
      setImageError(`상품 등록에 실패했습니다. ${error.message || ''}`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (readOnly || saving || preparing || creatorBusy || submitting.current) return;
    if (stockItem) return allocateStock();
    const price = Number(draft.price);
    const stockQty = Number(draft.stockQty);
    if (artists && !allowDirectArtist && !artists.some(artist => artist.ownerId === draft.ownerId)) return alert('행사에 등록된 제작자를 선택해주세요.');
    if (!draft.name.trim() || draft.price === '' || draft.stockQty === '' || !Number.isSafeInteger(price) || price < 0 || price > 2147483647 || !Number.isSafeInteger(stockQty) || stockQty < 0 || stockQty > 2147483647) return alert('상품 이름과 0 이상의 정수 판매가·재고를 입력해주세요.');
    const product = {
      ...draft, name: draft.name.trim(), productCode: draft.id, goodsType: draft.goodsType.trim(), vtuberName: draft.vtuberName.trim(), creatorName: artists ? (artists.find(artist => artist.ownerId === draft.ownerId)?.label || draft.creatorName || draft.artistName?.trim() || '') : draft.creatorName.trim(), genre: draft.genre.trim(),
      price, stockQty, stock: stockQty, initialStockQty: stockQty, size: '', isActive: true,
      setCreatorName: null, setGroupName: null, setPrice: null, setDescription: null, createdAt: new Date().toISOString(),
    };
    submitting.current = true;
    setBusy(true);
    setImageError('');
    try {
      if (!registered) {
        const request = pending.current || product;
        sessionStorage.setItem(pendingKey, JSON.stringify(request));
        pending.current = request;
        setUncertain(true);
        await registerProduct(request, { withImage: Boolean(image) });
        sessionStorage.removeItem(pendingKey);
        pending.current = null;
        setUncertain(false);
        savedProduct.current = true;
        setRegistered(true);
      }
      if (image && saveImage) await saveImage(image);
      else if (image) {
        const blob = uploadedImage.current?.file === image ? uploadedImage.current : await uploadProductImage(projectId, draft.id, image);
        uploadedImage.current = { file: image, url: blob.url };
        const attached = await imageChange.current(draft.id, blob.url);
        if (!attached) throw new Error('이미지 연결에 실패했습니다.');
      }
      clearUnsaved();
      onBack();
    } catch (error) {
      if (!savedProduct.current && error.status >= 400 && error.status < 500) { sessionStorage.removeItem(pendingKey); pending.current = null; setUncertain(false); }
      setImageError(savedProduct.current
        ? `상품은 등록되었지만 이미지 저장에 실패했습니다. 다시 저장하거나 상품 목록에서 이미지를 수정해주세요. ${error.message || ''}`
        : `상품 저장에 실패했습니다. ${error.message || ''}`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return <main className="page-content inventory-page">
    <PageIntro title="새 상품 등록" actions={<button type="button" disabled={saving || busy || preparing} className="management-back" onClick={onBack}>← 상품 목록으로</button>} />
    <form className="settings-content product-management" onSubmit={submit}>
      <fieldset disabled={readOnly || saving || busy || preparing} className="min-w-0"><div className="management-products">
        <article className="management-product">
          <div className="management-product-header"><h3>{(stockItem ? stockInfo?.name || stockItem.name : draft.name) || '새 상품'}</h3></div>
          <div className="management-product-body">
            {stockItem ? <div className="management-image"><ProductImage imageUrl={stockItem.imageUrl} name={stockItem.name} /></div> : <div className="management-image">
              <ProductImage imageUrl={preview} name={draft.name} />
              <label className="management-upload"><span>{preparing ? '이미지 축소 중…' : image ? '이미지 수정' : '이미지 등록'}</span><input aria-label="새 상품 이미지 등록 또는 수정" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; chooseImage(file); }} /></label>
              {image && <button type="button" className="management-delete" onClick={() => { setImage(null); setImageError(''); }}>이미지 제거</button>}
              <p>선택한 이미지는 상품 저장 시 등록됩니다.</p>
            </div>}
            <div className="management-details">
            {artists&&(fixedCreator?<fieldset className="creator-field"><legend>제작자</legend><p className="creator-field-fixed">{fixedCreator.label}</p></fieldset>:<CreatorField onBusyChange={setCreatorBusy} creators={artists} value={draft} onChange={value=>{setStockId('');setDraft(current=>({...current,...value,creatorName:value.label||value.artistName||''}));}} request={creatorRequest} project={creatorProject} allowDirect={allowDirectArtist} searchable={!allowDirectArtist} disabled={registered||uncertain} onRefresh={onRefreshCreators}/>)}
            {onAllocateStock && loadCreatorStock && draft.ownerId && !registered && !uncertain && <label className="management-field"><span>상품 선택</span><select aria-label="제작자 재고에서 상품 선택" value={stockId} disabled={stockLoad.loading} onChange={event => chooseStock(event.target.value)}><option value="">새 상품으로 등록</option>{creatorStock.map(item => <option key={item.id} value={item.id} disabled={item.quantityEditable === false}>{item.name} · 재고 {Math.max(0, Number(item.warehouse) || 0)}개</option>)}</select>{stockLoad.error && <small role="alert" className="inventory-error">{stockLoad.error}</small>}</label>}
            {stockItem ? <>
            <InventoryProductFields hideCreator draft={stockInfo || infoOf(stockItem)} products={products} onChange={(key, value) => setStockInfo(current => ({ ...(current || infoOf(stockItem)), [key]: value }))} disabled={readOnly || saving || busy || preparing} />
            <fieldset><legend>가격 · 배정</legend><div className="management-fields">
              <label className="management-field"><span>판매가 (원)</span><Input required type="number" min="0" max="2147483647" step="1" value={stockPrice} onChange={value => setStockPrice(value)} /></label>
              <label className="management-field"><span>행사 배정 수량</span><Input required type="number" min="0" max={Math.max(0, Number(stockItem.warehouse) || 0)} step="1" value={stockQty} onChange={value => setStockQty(value)} /></label>
            </div></fieldset></> : <>
            <InventoryProductFields hideCreator={Boolean(artists)} draft={draft} products={products} onChange={change} disabled={registered || uncertain || readOnly || saving || busy || preparing} />
            <fieldset disabled={registered || uncertain}><legend>가격 · 재고</legend><div className="management-fields">
              <label className="management-field"><span>판매가 (원)</span><Input required type="number" min="0" max="2147483647" step="1" value={draft.price} onChange={value => change('price', value)} /></label>
              <label className="management-field"><span>최초 입고 수량</span><Input required type="number" min="0" max="2147483647" step="1" value={draft.stockQty} onChange={value => change('stockQty', value)} /></label>
            </div></fieldset>
            <p className="management-note">최초 입고 수량을 상품·재고에 기록하고 전량을 현재 행사에 배정합니다. 판매가는 이 행사에만 적용됩니다.</p>
            </>}
            {imageError && <p role="alert" className="management-note">{imageError}</p>}
            <button data-guide="save" type="submit" className="management-add" disabled={creatorBusy}>{saving || busy ? '저장 중…' : registered ? (image ? '이미지 다시 저장' : '등록 완료') : '상품 등록'}</button>
            </div>
          </div>
        </article>
      </div></fieldset>
    </form>
  </main>;
}
