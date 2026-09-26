// Check the Hardware Expert's answer. If the AI failed or named products we don't have,
// answer straight from the product list instead.
const c = $('Build Context').first(0).json;
const res = $input.first()?.json ?? {};
const th = c.lang !== 'en';
const full = Object.fromEntries(c.catalog.map(p => [p.sku, p]));
const allowed = new Set(c.relevant.map(p => p.sku));
const card = p => ({ sku: p.sku, name: p.name, image_url: p.image_url, price_ex_vat: p.price_ex_vat, price_inc_vat: p.price_inc_vat, stock_qty: p.stock_qty });

const out = res.ok === true && res.data && typeof res.data.reply === 'string' && res.data.reply.trim() ? res.data : null;
if (out) {
  const proposed = (Array.isArray(out.product_skus) ? out.product_skus : []).map(s => String(s).trim().toUpperCase());
  const invented = proposed.some(s => !allowed.has(s));
  if (!invented) {
    const skus = [...new Set(proposed)].slice(0, 3);
    const oos = String(out.open_suggestion_sku ?? '').trim().toUpperCase();
    const open = allowed.has(oos) && full[oos].stock_qty === 0 ? oos : '';
    return [{ json: {
      agent: 'hardware_expert', reply: out.reply.trim(), products: skus.map(s => card(full[s])),
      open_suggestion_sku: open, next_stage: '', product_sku: open, degraded: false, ai_tier: res.tier ?? 0,
    } }];
  }
}

const inStock = c.relevant.filter(p => p.stock_qty > 0).slice(0, 3).map(p => card(full[p.sku]));
const reply = inStock.length
  ? (th ? 'ตอนนี้ผู้ช่วยแนะนำสินค้าตอบได้จำกัด นี่คือสินค้าพร้อมส่งที่ตรงกับคำถามของคุณครับ'
        : 'Our product assistant is limited right now. Here are in-stock products that match your question.')
  : (th ? `ขออภัยครับ ตอนนี้ระบบแนะนำสินค้าขัดข้องชั่วคราว รบกวนลองใหม่อีกครั้ง หรือติดต่อพนักงานที่ ${c.store.store_contact}`
        : `Sorry, product advice is temporarily unavailable. Please try again or contact our staff: ${c.store.store_contact}`);

return [{ json: {
  agent: 'hardware_expert', reply, products: inStock, open_suggestion_sku: '', next_stage: '', product_sku: '',
  degraded: true, ai_tier: 0,
} }];
