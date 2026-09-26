// Check the Suggestion answer: recommended SKUs must be real in-stock candidates.
// If the AI failed or invented a product, fall back to the closest-price in-stock alternatives.
const c = $('Build Context').first(0).json;
const res = $input.first()?.json ?? {};
const th = c.lang !== 'en';
const full = Object.fromEntries(c.catalog.map(p => [p.sku, p]));
const allowed = new Set(c.candidates.map(p => p.sku));
const card = p => ({ sku: p.sku, name: p.name, image_url: p.image_url, price_ex_vat: p.price_ex_vat, price_inc_vat: p.price_inc_vat, stock_qty: p.stock_qty });

const out = res.ok === true && res.data && typeof res.data.reply === 'string' && res.data.reply.trim() ? res.data : null;
if (out) {
  const proposed = (Array.isArray(out.recommended_skus) ? out.recommended_skus : []).map(s => String(s).trim().toUpperCase());
  const invented = proposed.some(s => !allowed.has(s));
  const skus = [...new Set(proposed)].filter(s => allowed.has(s)).slice(0, 3);
  const isQuestion = out.follow_up_question === true && skus.length === 0;
  if (!invented && (skus.length || isQuestion)) {
    return [{ json: {
      agent: 'hardware_expert', reply: out.reply.trim(), products: skus.map(s => card(full[s])),
      next_stage: 'recommend', product_sku: c.product_sku, degraded: false, ai_tier: res.tier ?? 0,
    } }];
  }
}

// no usable AI answer: rank by fit to the usage the customer typed (tags), then by closest price (the list order)
const terms = new Set(c.message_terms ?? []);
const fit = p => String(p.tags ?? '').split(',').filter(t => terms.has(t.trim())).length;
const picks = [...c.candidates].sort((a, b) => fit(b) - fit(a)).slice(0, 3).map(p => card(full[p.sku]));
const reply = th
  ? `ตอนนี้ระบบแนะนำอัตโนมัติใช้งานได้จำกัด นี่คือสินค้าพร้อมส่งที่ใกล้เคียงกับ ${c.target.name} มากที่สุดครับ`
  : `Our recommendation assistant is limited right now. Here are the closest in-stock alternatives to ${c.target.name}.`;

return [{ json: {
  agent: 'hardware_expert', reply, products: picks, next_stage: 'recommend', product_sku: c.product_sku,
  degraded: true, ai_tier: 0,
} }];
