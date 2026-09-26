// Exact price and VAT math in satang (whole numbers), never done by the AI.
// Items come from the storefront cart, from the AI's shopping list, or, if the AI failed, from SKUs typed in the message.
const c = $('Build Context').first(0).json;
const inp = $input.first()?.json ?? {};
const th = c.lang !== 'en';
const VAT = c.vat_rate;
const bySku = Object.fromEntries(c.catalog.map(p => [p.sku, p]));
const card = p => ({ sku: p.sku, name: p.name, image_url: p.image_url, price_ex_vat: p.price_ex_vat, price_inc_vat: p.price_inc_vat, stock_qty: p.stock_qty });
const toQty = v => Math.min(999, Math.max(1, parseInt(v, 10) || 1));

if (c.inventory_ok === false) {
  const reply = th
    ? `ขออภัยครับ ตอนนี้ระบบราคาสินค้าขัดข้องชั่วคราว ยังคำนวณราคาให้ไม่ได้ รบกวนลองใหม่อีกครั้งในอีกสักครู่ หรือติดต่อพนักงานที่ ${c.store.store_contact}`
    : `Sorry, our price list is temporarily unavailable, so I can't calculate totals right now. Please try again shortly or contact our staff: ${c.store.store_contact}`;
  return [{ json: { agent: 'calculator', reply, products: [], totals: null, next_stage: '', degraded: true, ai_tier: 0 } }];
}

let lines = [];
let unmatched = [];
let degraded = false;
let ai_tier = 0;

if (inp.route_hint === 'cart_total') {
  for (const l of c.cart) bySku[l.sku] ? lines.push({ sku: l.sku, qty: l.qty }) : unmatched.push(l.sku);
} else if (inp.ok === true && inp.data && Array.isArray(inp.data.items)) {
  ai_tier = inp.tier ?? 0;
  for (const it of inp.data.items) {
    const sku = String(it?.sku ?? '').trim().toUpperCase();
    bySku[sku] ? lines.push({ sku, qty: toQty(it?.qty) }) : unmatched.push(String(it?.sku ?? ''));
  }
  if (Array.isArray(inp.data.unmatched)) unmatched.push(...inp.data.unmatched.map(String));
} else {
  degraded = true;
  const re = /([A-Za-z]{2,}-\d{2,})(?:\s*[x×*]\s*(\d+)|\s+(\d+)(?:\s*(?:ชิ้น|ตัว|อัน|pcs?))?)?/g;
  let m;
  while ((m = re.exec(c.message))) {
    const sku = m[1].toUpperCase();
    if (bySku[sku]) lines.push({ sku, qty: toQty(m[2] || m[3] || 1) });
  }
  if (!lines.length) for (const l of c.cart) if (bySku[l.sku]) lines.push({ sku: l.sku, qty: l.qty });
}

const merged = {};
for (const l of lines) merged[l.sku] = (merged[l.sku] ?? 0) + l.qty;
unmatched = [...new Set(unmatched.map(s => s.trim()).filter(Boolean))];

if (!Object.keys(merged).length) {
  const reply = th
    ? 'ขออภัยครับ ยังไม่พบสินค้าที่จะคำนวณ รบกวนเพิ่มสินค้าลงตะกร้าแล้วกด "คำนวณราคา" หรือพิมพ์รหัสสินค้าพร้อมจำนวน เช่น MS-002 x2'
    : 'Sorry, I could not find the items to calculate. Add them to your cart and press "Calculate", or type product codes with quantities, e.g. MS-002 x2.';
  return [{ json: { agent: 'calculator', reply, products: [], totals: null, next_stage: '', degraded, ai_tier } }];
}

let subtotal = 0;
const out = Object.entries(merged).map(([sku, qty]) => {
  const p = bySku[sku];
  const unit = Math.round(p.price_ex_vat * 100);
  subtotal += unit * qty;
  return { sku, name: p.name, qty, unit_ex_vat: unit / 100, line_ex_vat: (unit * qty) / 100, in_stock: p.stock_qty >= qty, stock_qty: p.stock_qty };
});
const vat = Math.round(subtotal * VAT);
const totals = {
  lines: out, subtotal_ex_vat: subtotal / 100, vat: vat / 100, vat_rate: VAT,
  total_inc_vat: (subtotal + vat) / 100, unmatched,
};

const baht = n => '฿' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pct = Math.round(VAT * 1000) / 10;
const stockNote = l => l.in_stock ? ''
  : l.stock_qty === 0 ? (th ? ' (สินค้าหมด)' : ' (sold out)')
  : (th ? ` (มีในสต็อกแค่ ${l.stock_qty} ชิ้น)` : ` (only ${l.stock_qty} in stock)`);
const rows = out.map(l => `• ${l.name} x${l.qty} = ${baht(l.line_ex_vat)}${stockNote(l)}`);
const lines_th = ['สรุปราคาครับ', ...rows, `ราคาก่อน VAT ${baht(totals.subtotal_ex_vat)}`, `VAT ${pct}% ${baht(totals.vat)}`, `รวมทั้งสิ้น ${baht(totals.total_inc_vat)}`];
const lines_en = ['Here is your total:', ...rows, `Subtotal before VAT ${baht(totals.subtotal_ex_vat)}`, `VAT ${pct}% ${baht(totals.vat)}`, `Total ${baht(totals.total_inc_vat)}`];
let reply = (th ? lines_th : lines_en).join('\n');
if (unmatched.length) reply += th ? `\nไม่พบสินค้า: ${unmatched.join(', ')}` : `\nNot found: ${unmatched.join(', ')}`;

return [{ json: {
  agent: 'calculator', reply, products: out.map(l => card(bySku[l.sku])), totals, next_stage: '', degraded, ai_tier,
} }];
