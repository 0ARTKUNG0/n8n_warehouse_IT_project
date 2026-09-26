// Gather everything the rest of the workflow needs: history, products, and the route to take.
// Never throws: if anything goes wrong it continues without product data instead of stopping.
const req = $('Normalize Request').first(0).json;
const settings = $('Store Settings').first(0).json;
const store = {
  store_name: String(settings.store_name ?? 'our store'),
  store_contact: String(settings.store_contact ?? ''),
  store_hours: String(settings.store_hours ?? ''),
  store_policies: String(settings.store_policies ?? ''),
};
const txt = v => String(v ?? '').trim();
const incVat = n => Math.round(n * (1 + req.vat_rate) * 100) / 100;

const SYNONYMS = {
  'เมาส์': 'mouse', 'เม้าส์': 'mouse', 'คีย์บอร์ด': 'keyboard', 'คีบอร์ด': 'keyboard', 'แป้นพิมพ์': 'keyboard',
  'หูฟัง': 'headset', 'เฮดเซ็ต': 'headset', 'มอนิเตอร์': 'monitor', 'หน้าจอ': 'monitor', 'เว็บแคม': 'webcam',
  'กล้อง': 'webcam', 'แผ่นรองเมาส์': 'mousepad', 'ลำโพง': 'speaker', 'เกมมิ่ง': 'gaming', 'เกม': 'gaming',
  'ไร้สาย': 'wireless', 'บลูทูธ': 'bluetooth', 'มีสาย': 'wired', 'ออฟฟิศ': 'office', 'ทำงาน': 'office',
  'เรียน': 'office', 'เงียบ': 'silent', 'น้ำหนักเบา': 'lightweight', 'ประหยัด': 'budget', 'ราคาถูก': 'budget',
  'แนวตั้ง': 'vertical', 'ปวดข้อมือ': 'ergonomic', 'เออร์โกโนมิก': 'ergonomic', 'เมคานิคอล': 'mechanical',
  'แมคคานิคอล': 'mechanical', 'ไมค์': 'microphone', 'ประชุม': 'calls', 'รอบทิศทาง': 'surround', 'ยิง': 'fps',
  'valorant': 'fps', 'cs2': 'fps', 'csgo': 'fps', 'pubg': 'fps', 'rov': 'moba', 'dota': 'moba', 'แป้นไทย': 'thai-keycaps',
};

try {
  // conversation history: the data table returns newest first
  const history = $('Load History').all(0)
    .map(i => i.json)
    .filter(r => r && txt(r.session_id) && txt(r.content))
    .reverse();
  const history_text = history
    .map(r => `${r.role === 'customer' ? 'Customer' : 'Store'}: ${txt(r.content).slice(0, 300)}`)
    .join('\n');
  const lastStore = [...history].reverse().find(r => r.role !== 'customer');

  // products
  const catalog = $('Load Inventory').all(0)
    .map(i => i.json)
    .filter(p => p && txt(p.sku))
    .map(p => {
      const price = Number(p.price_ex_vat) || 0;
      return {
        sku: txt(p.sku).toUpperCase(),
        name: txt(p.name),
        category: txt(p.category).toLowerCase(),
        price_ex_vat: price,
        price_inc_vat: incVat(price),
        stock_qty: Math.max(0, parseInt(p.stock_qty, 10) || 0),
        image_url: txt(p.image_url),
        description: txt(p.description).slice(0, 300),
        tags: txt(p.tags).toLowerCase(),
      };
    });
  const bySku = Object.fromEntries(catalog.map(p => [p.sku, p]));
  const compact = p => ({
    sku: p.sku, name: p.name, category: p.category, price_inc_vat: p.price_inc_vat,
    stock_qty: p.stock_qty, tags: p.tags, description: p.description,
  });

  // products that match the message (Thai words are mapped to English tags)
  const msg = req.message.toLowerCase();
  const terms = new Set(msg.split(/[^a-z0-9-]+/).filter(w => w.length >= 2));
  for (const [th, en] of Object.entries(SYNONYMS)) if (msg.includes(th)) terms.add(en);
  const score = p => {
    let s = msg.includes(p.sku.toLowerCase()) ? 20 : 0;
    if (terms.has(p.category)) s += 4;
    for (const t of p.tags.split(',')) if (t && terms.has(t.trim())) s += 2;
    for (const w of p.name.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3 && terms.has(w)) s += 3;
    return s;
  };
  const ranked = catalog
    .map(p => ({ p, s: score(p) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.p.stock_qty > 0) - (a.p.stock_qty > 0))
    .map(x => x.p);
  // if the customer names a category ("เมาส์", "keyboard"), keep only that category
  const named = new Set(catalog.map(p => p.category).filter(cat => terms.has(cat)));
  const pool = named.size ? ranked.filter(p => named.has(p.category)) : ranked;
  // products already talked about, so follow-ups like "which of the two is lighter?" keep their context.
  // Keep the order of the store's last message, so "the first one" / "อันที่สอง" means the same product to the AI.
  const historyUpper = history.map(r => txt(r.content)).join('\n').toUpperCase();
  const lastUpper = lastStore ? txt(lastStore.content).toUpperCase() : '';
  const firstSeen = p => {
    const at = [lastUpper.indexOf(p.name.toUpperCase()), lastUpper.indexOf(p.sku)].filter(i => i >= 0);
    return at.length ? Math.min(...at) : Infinity;
  };
  const mentioned = catalog
    .filter(p => historyUpper.includes(p.name.toUpperCase()) || historyUpper.includes(p.sku))
    .sort((a, b) => firstSeen(a) - firstSeen(b));
  const primary = pool.length ? pool : mentioned.length ? mentioned : catalog.filter(p => p.stock_qty > 0);
  const relevant = [...new Set([...primary, ...mentioned])].slice(0, 8);
  const calc_catalog = (catalog.length <= 80 ? catalog : [...new Set([...mentioned, ...ranked])].slice(0, 30))
    .map(p => ({ sku: p.sku, name: p.name, in_stock: p.stock_qty > 0 }));

  // suggestion flow: the sold-out product and in-stock alternatives in the same category, closest price first
  const target = req.product_sku ? bySku[req.product_sku] ?? null : null;
  let candidates = [];
  if (target) {
    const base = target.price_ex_vat;
    candidates = catalog
      .filter(p => p.sku !== target.sku && p.category === target.category && p.stock_qty > 0)
      .map(p => ({ ...compact(p), price_diff_pct: base ? Math.round(((p.price_ex_vat - base) / base) * 100) : null }))
      .sort((a, b) => Math.abs(a.price_diff_pct ?? 0) - Math.abs(b.price_diff_pct ?? 0))
      .slice(0, 12);
  }

  let route_hint = 'chat';
  let suggestion_kind = '';
  if (req.mode === 'cart_total') route_hint = 'cart_total';
  if (req.mode === 'suggestion') {
    route_hint = 'suggestion_fixed';
    if (!target) suggestion_kind = 'missing';
    else if (target.stock_qty > 0) suggestion_kind = 'in_stock';
    else if (!req.message) suggestion_kind = 'ask';
    else if (!candidates.length) suggestion_kind = 'none';
    else route_hint = 'suggestion_ai';
  }

  return [{ json: {
    ...req, store,
    history_text, last_assistant: lastStore ? txt(lastStore.content).slice(0, 600) : '',
    inventory_ok: catalog.length > 0, catalog, relevant: relevant.map(compact), calc_catalog,
    target: target ? { ...compact(target), price_ex_vat: target.price_ex_vat, image_url: target.image_url } : null,
    candidates, route_hint, suggestion_kind, message_terms: [...terms],
  } }];
} catch (e) {
  return [{ json: {
    ...req, store, history_text: '', last_assistant: '', inventory_ok: false, catalog: [], relevant: [],
    calc_catalog: [], target: null, candidates: [], message_terms: [],
    route_hint: req.mode === 'suggestion' ? 'suggestion_fixed' : 'chat',
    suggestion_kind: req.mode === 'suggestion' ? 'missing' : '',
    context_error: e.message,
  } }];
}
