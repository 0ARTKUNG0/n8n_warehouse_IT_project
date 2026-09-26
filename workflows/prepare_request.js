// Read the website's request, pick the products that match the question (at most 30)
// and turn them into text for the AI. The whole sheet is too big to send on every message.
const body = $('Webhook').first(0).json.body ?? {};
const txt = v => String(v ?? '').trim();
const num = v => (typeof v === 'number' ? v : txt(v) === '' ? NaN : Number(txt(v).replace(/[^0-9.-]/g, '')));
const session_id = txt(body.session_id) || 'guest';
const sku = txt(body.product_sku).toUpperCase();
// opened from a sold-out product page with no message yet
const message = txt(body.message).slice(0, 1000) || (sku ? `สินค้า ${sku} หมด ช่วยแนะนำตัวอื่นให้หน่อย` : 'สวัสดี');
const m = message.toLowerCase();

// rows with a missing sku, name or price are skipped
const products = $input.all().map(i => i.json)
  .filter(p => txt(p.sku) && txt(p.name) && Number.isFinite(num(p.price_ex_vat)))
  .map(p => ({ ...p, sku: txt(p.sku).toUpperCase(), category: txt(p.category).toLowerCase(), price: num(p.price_ex_vat), stock: num(p.stock_qty) || 0,
               hay: ` ${txt(p.sku)} ${txt(p.name)} ${txt(p.tags)} ${txt(p.description)} `.toLowerCase() }))
  .map(p => ({ ...p, hay2: p.hay.replace(/\s+/g, '') }));  // "16gb" also finds "16 GB"

// words that name a category, Thai and English
const CATEGORY_WORDS = {
  gpu: ['การ์ดจอ', 'gpu', 'graphics card', 'rtx', 'gtx', 'radeon', 'geforce'],
  cpu: ['ซีพียู', 'cpu', 'processor', 'ryzen', 'core i3', 'core i5', 'core i7', 'core i9', 'ultra 5', 'ultra 7'],
  'cpu-cooler': ['ระบายความร้อน', 'ซิงค์', 'ชุดน้ำ', 'cooler', 'heatsink', 'aio'],
  motherboard: ['เมนบอร์ด', 'เมนบอด', 'motherboard', 'mainboard'],
  ram: ['แรม', 'ram', 'ddr4', 'ddr5'],
  ssd: ['ssd', 'nvme', 'm.2'],
  hdd: ['ฮาร์ดดิสก์', 'hdd', 'hard disk', 'harddisk'],
  psu: ['พาวเวอร์', 'psu', 'power supply', 'วัตต์'],
  case: ['เคส', 'case'],
  monitor: ['จอ', 'นิ้ว', 'monitor', 'inch'],
};
const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (text, w) => /^[a-z0-9 .]+$/.test(w) ? new RegExp(`(^|[^a-z0-9])${esc(w)}([^a-z0-9]|$)`).test(text) : text.includes(w);
const STOP = new Set(['the', 'for', 'and', 'with', 'what', 'how', 'much', 'is', 'are', 'do', 'you', 'have', 'vat', 'price', 'total', 'buy', 'want', 'need', 'can', 'my', 'me', 'it', 'in', 'of', 'to', 'a', 'an', 'or', 'pc', 'gb', 'tb']);

const noGpu = m.replace(/การ์ดจอ/g, ' ');  // "การ์ดจอ" (graphics card) is not a monitor
let cats = Object.keys(CATEGORY_WORDS).filter(c => CATEGORY_WORDS[c].some(w => has(c === 'monitor' ? noGpu : m, w)));
let terms = (m.match(/[a-z0-9][a-z0-9.+-]*/g) ?? []).filter(t => t.length >= 2 && !STOP.has(t));
const asked = sku && products.find(p => p.sku === sku);
if (asked) { cats = [...new Set([...cats, asked.category])]; terms = [...terms, sku.toLowerCase()]; }

// a follow-up like "for gaming" names no product type: keep this chat's last search and add to it
let memo = { searches: {} };
try { memo = $getWorkflowStaticData('global'); memo.searches = memo.searches ?? {}; } catch (e) {}
const now = Date.now();
for (const [k, v] of Object.entries(memo.searches)) if (now - v.at > 24 * 3600e3) delete memo.searches[k];
const last = memo.searches[session_id];
if (!cats.length && last) { cats = last.cats; terms = [...new Set([...last.terms, ...terms])].slice(-8); }
// a word that only a few products have (a model like "5600x") counts more than a common one ("ddr4")
// "16gb" or "144hz" may be written "16 GB" / "144 Hz" in the sheet; other words must match as they are
const found = (p, t) => p.hay.includes(t) || (/\d/.test(t) && /[a-z]/.test(t) && p.hay2.includes(t));
const matches = p => terms.filter(t => found(p, t));
const df = Object.fromEntries(terms.map(t => [t, products.filter(p => found(p, t)).length]));
const score = p => matches(p).reduce((sum, t) => sum + 1 / df[t], 0);
const specific = p => matches(p).some(t => df[t] <= 20);
const scored = products.map(p => ({ p, s: score(p) }))
  .filter(x => x.s > 0 && (!cats.length || cats.includes(x.p.category) || specific(x.p)))
  .sort((a, b) => b.s - a.s || (b.p.stock > 0) - (a.p.stock > 0) || a.p.price - b.p.price);
// best matches, taking turns between product types so "CPU and RAM" gets both
const groups = new Map();
for (const { p } of scored) { if (!groups.has(p.category)) groups.set(p.category, []); groups.get(p.category).push(p); }
let picks = [];
while (picks.length < 16 && [...groups.values()].some(g => g.length)) {
  for (const g of groups.values()) if (g.length && picks.length < 16) picks.push(g.shift());
}
// in-stock alternatives of the same types: closest in price to the best match, or spread over all prices
const types = cats.length ? cats : [...new Set(picks.map(p => p.category))];
const each = Math.max(3, Math.floor((30 - picks.length) / Math.max(1, types.length)));
for (const type of types) {
  const anchor = picks.find(p => p.category === type)?.price;
  let pool = products.filter(p => p.category === type && p.stock > 0 && !picks.includes(p));
  if (anchor !== undefined) pool.sort((a, b) => Math.abs(a.price - anchor) - Math.abs(b.price - anchor));
  else { pool.sort((a, b) => a.price - b.price); const step = pool.length / each; pool = Array.from({ length: Math.min(each, pool.length) }, (_, i) => pool[Math.floor(i * step)]); }
  picks.push(...pool.slice(0, each));
}
picks = picks.slice(0, 30);
if (!picks.length) {
  // nothing named yet ("hello"): a few in-stock products from every category
  const byCat = {};
  for (const p of products.filter(p => p.stock > 0).sort((a, b) => a.price - b.price)) (byCat[p.category] ??= []).push(p);
  picks = Object.values(byCat).flatMap(list => list.slice(0, 3)).slice(0, 30);
}
if (terms.length || cats.length) memo.searches[session_id] = { terms, cats, at: now };

const money = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lines = picks.map(p => [
  p.sku, txt(p.name), p.category,
  `฿${money(p.price)} before VAT, ฿${money(p.price * 1.07)} incl. VAT`,
  p.stock > 0 ? `in stock: ${p.stock}` : 'SOLD OUT',
  `tags: ${txt(p.tags)}`,
  txt(p.description).slice(0, 250),
].join(' | '));
const products_text = products.length
  ? `(The store has ${products.length} products; these ${lines.length} match this question best. If what the customer wants isn't listed, ask for the exact model or type instead of saying the store doesn't have it.)\n${lines.join('\n')}`
  : 'The product list is not available right now. Do not name any products.';

// mode "order" (sent by a front-store app) always goes to the Order Desk
return [{ json: { session_id, message, products_text, mode: txt(body.mode).toLowerCase() } }];
