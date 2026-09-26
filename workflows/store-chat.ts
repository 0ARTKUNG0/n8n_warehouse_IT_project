import { workflow, node, trigger, sticky, placeholder, newCredential, languageModel, memory, tool, expr } from '@n8n/workflow-sdk';

const groq_main_model = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGroq', version: 1, config: { name: 'Groq (main model)', parameters: { model: 'openai/gpt-oss-120b', options: { temperature: 0.3, maxTokensToSample: 2048 } }, credentials: { groqApi: newCredential('Groq account', 'fk0N9mxbYr8EqEaP') }, position: [900, 560] } });
const router_Memory = memory({ type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', version: 1.4, config: { name: 'Router Memory', parameters: { sessionIdType: 'customKey', sessionKey: expr('{{ $(\'Prepare Request\').first(0).json.session_id }}:router'), contextWindowLength: 4 }, position: [740, 560] } });
const gemini_backup_model = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.1, config: { name: 'Gemini (backup model)', parameters: { modelName: 'models/gemini-flash-latest', options: { temperature: 0.3, maxOutputTokens: 2048 } }, credentials: { googlePalmApi: newCredential('Google Gemini(PaLM) Api account', 'iEXJevGkgXLcbG0R') }, position: [1060, 560] } });
const chat_Memory = memory({ type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', version: 1.4, config: { name: 'Chat Memory', parameters: { sessionIdType: 'customKey', sessionKey: expr('{{ $(\'Prepare Request\').first(0).json.session_id }}'), contextWindowLength: 8 }, position: [1500, 700] } });
const calculator_Tool = tool({ type: '@n8n/n8n-nodes-langchain.toolCalculator', version: 1, config: { name: 'Calculator Tool', position: [1660, 700] } });

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: { name: 'Webhook', parameters: { httpMethod: 'POST', path: 'store-assistant', responseMode: 'responseNode', options: {} }, position: [0, 300], webhookId: 'c4a6c6a5-8f14-44ea-bb01-3f83bed27e8b' }
});

const store_Info = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: { name: 'Store Info', parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [{ id: 'store-name', name: 'store_name', value: 'IT Warehouse', type: 'string' }, { id: 'contact', name: 'contact', value: 'หน้า "ติดต่อเรา" บนเว็บไซต์', type: 'string' }, { id: 'hours', name: 'hours', value: 'ดูเวลาทำการได้ที่หน้าเว็บไซต์', type: 'string' }, { id: 'policies', name: 'policies', value: 'เรื่องการรับประกัน การเปลี่ยนหรือคืนสินค้า ให้ติดต่อพนักงาน', type: 'string' }] } }, position: [220, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 }
});

const get_Products = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: { name: 'Get Products', parameters: { resource: 'sheet', operation: 'read', authentication: 'oAuth2', documentId: { __rl: true, mode: 'list', value: '', cachedResultName: 'inventory' }, sheetName: { __rl: true, mode: 'name', value: 'Inventory' }, options: {} }, credentials: { googleSheetsOAuth2Api: newCredential('Google Sheets account', 'aiEpt4MCfgtCCgZ1') }, position: [440, 300], executeOnce: true, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, alwaysOutputData: true, onError: 'continueRegularOutput' }
});

const prepare_Request = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Request',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `// Read the website's request, pick the products that match the question (at most 30)
// and turn them into text for the AI. The whole sheet is too big to send on every message.
const body = $('Webhook').first(0).json.body ?? {};
const txt = v => String(v ?? '').trim();
const num = v => (typeof v === 'number' ? v : txt(v) === '' ? NaN : Number(txt(v).replace(/[^0-9.-]/g, '')));
const session_id = txt(body.session_id) || 'guest';
const sku = txt(body.product_sku).toUpperCase();
// opened from a sold-out product page with no message yet
const message = txt(body.message).slice(0, 1000) || (sku ? \`สินค้า \${sku} หมด ช่วยแนะนำตัวอื่นให้หน่อย\` : 'สวัสดี');
const m = message.toLowerCase();

// rows with a missing sku, name or price are skipped
const products = $input.all().map(i => i.json)
  .filter(p => txt(p.sku) && txt(p.name) && Number.isFinite(num(p.price_ex_vat)))
  .map(p => ({ ...p, sku: txt(p.sku).toUpperCase(), category: txt(p.category).toLowerCase(), price: num(p.price_ex_vat), stock: num(p.stock_qty) || 0,
               hay: \` \${txt(p.sku)} \${txt(p.name)} \${txt(p.tags)} \${txt(p.description)} \`.toLowerCase() }))
  .map(p => ({ ...p, hay2: p.hay.replace(/\\s+/g, '') }));  // "16gb" also finds "16 GB"

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
const esc = w => w.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
const has = (text, w) => /^[a-z0-9 .]+$/.test(w) ? new RegExp(\`(^|[^a-z0-9])\${esc(w)}([^a-z0-9]|$)\`).test(text) : text.includes(w);
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
const found = (p, t) => p.hay.includes(t) || (/\\d/.test(t) && /[a-z]/.test(t) && p.hay2.includes(t));
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
  \`฿\${money(p.price)} before VAT, ฿\${money(p.price * 1.07)} incl. VAT\`,
  p.stock > 0 ? \`in stock: \${p.stock}\` : 'SOLD OUT',
  \`tags: \${txt(p.tags)}\`,
  txt(p.description).slice(0, 250),
].join(' | '));
const products_text = products.length
  ? \`(The store has \${products.length} products; these \${lines.length} match the latest message best. Products talked about earlier in this chat may not be listed here: that does not mean they are sold out or missing. If what the customer wants isn't listed, ask for the exact model or type instead of saying the store doesn't have it.)\\n\${lines.join('\\n')}\`
  : 'The product list is not available right now. Do not name any products.';

// mode "order" (sent by a front-store app) always goes to the Order Desk
return [{ json: { session_id, message, products_text, mode: txt(body.mode).toLowerCase() } }];
`
    },
    position: [660, 300],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000
  }
});

const router = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Router',
    parameters: {
      promptType: 'define',
      text: expr('{{ $json.message }}'),
      needsFallback: true,
      options: {
              systemMessage: `Classify the customer's message for a computer-hardware warehouse. Answer with exactly one word:
order = a front store sends a PC spec or parts list to order, confirms, cancels or changes an order, or gives its store location
hardware = questions about products, recommendations, specs, stock, sold-out products, or the customer telling what they will use a product for
calculator = prices for quantities, totals, VAT, quotations
troubleshooter = problems, setup, drivers, warranty, returns, delivery
If your previous answer was order and the customer is confirming, answering yes or no, or giving a location, answer order. If unsure, answer hardware.`,
              maxIterations: 3,
              enableStreaming: false
            }
    },
    position: [900, 300],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    subnodes: { model: [groq_main_model, gemini_backup_model], memory: router_Memory }
  }
});

const route = node({
  type: 'n8n-nodes-base.switch',
  version: 3.4,
  config: { name: 'Route', parameters: { mode: 'rules', rules: { values: [{ outputKey: 'order', renameOutput: true, conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr('{{ ($(\'Prepare Request\').first(0).json.mode === \'order\' ? \'order \' : \'\') + ($json.output ?? \'\') }}'), rightValue: 'order', operator: { type: 'string', operation: 'contains' } }], combinator: 'and' } }, { outputKey: 'calculator', renameOutput: true, conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr('{{ ($(\'Prepare Request\').first(0).json.mode === \'order\' ? \'order \' : \'\') + ($json.output ?? \'\') }}'), rightValue: 'calculator', operator: { type: 'string', operation: 'contains' } }], combinator: 'and' } }, { outputKey: 'troubleshooter', renameOutput: true, conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr('{{ ($(\'Prepare Request\').first(0).json.mode === \'order\' ? \'order \' : \'\') + ($json.output ?? \'\') }}'), rightValue: 'troubleshoot', operator: { type: 'string', operation: 'contains' } }], combinator: 'and' } }] }, options: { fallbackOutput: 'extra', renameFallbackOutput: 'hardware' } }, position: [1140, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 }
});

const order_Desk = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Order Desk',
    parameters: {
      promptType: 'define',
      text: expr('{{ $(\'Prepare Request\').first(0).json.message }}'),
      needsFallback: true,
      options: {
              systemMessage: expr(`You are the Order Desk of the {{ $('Store Info').first(0).json.store_name }} warehouse. Front-store staff order PC parts from the warehouse. Reply in their language (Thai or English), short and clear.
1. They send a PC spec or a parts list. Match every part to PRODUCTS and use its SKU. If no quantity is given, use 1.
2. For each part, say if it is in stock with enough quantity. If it is SOLD OUT or there isn't enough, recommend the closest IN-STOCK alternative that fits the rest of the spec, and say why.
3. Check the parts fit together (CPU socket = motherboard socket, RAM type = motherboard memory type, enough power supply watts for the graphics card).
4. Show the order: one line per part "SKU name x qty = price incl. VAT", then the total incl. VAT (use the Calculator Tool). Ask them to confirm.
5. When they confirm, ask for their front-store location (branch name or address) if you don't have it yet.
6. Only when they have confirmed AND given the location, end your reply with this exact line, using the final SKUs and quantities:
ORDER_JSON: {"location": "branch or address", "items": [{"sku": "SKU", "qty": 1}]}
Never write ORDER_JSON before they confirm, and never write it twice for the same order. If they change the order, show the new summary and ask again.
PRODUCTS only lists the products that match their latest message, so after a reply like "yes" or a branch name it shows other products. The parts in your last summary are still valid even when they are not in PRODUCTS: never call them missing or sold out for that reason, and use their SKUs exactly as you wrote them. The system re-checks stock against the live sheet before it places the order.

PRODUCTS (sku | name | category | price | stock | tags | description):
{{ $('Prepare Request').first(0).json.products_text }}`),
              maxIterations: 8,
              enableStreaming: false
            }
    },
    position: [1500, 1000],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    subnodes: { model: [groq_main_model, gemini_backup_model], memory: chat_Memory, tools: [calculator_Tool] }
  }
});

const check_Order = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Check Order',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `// The Order Desk writes ORDER_JSON only after the front store confirmed and gave its location.
// Check that order against the sheet as it is right now; only then is stock taken off.
const out = String($json.output ?? '');
const at = out.search(/ORDER_JSON/i);
// the text before ORDER_JSON, without a dangling \`\`\` or ** the AI may have put around it
const reply = (at < 0 ? out : out.slice(0, at)).replace(/(^|\\n)\\s*(\`\`\`[a-z]*|\\*\\*|\`)\\s*$/i, '').trim();
const answer = text => [{ json: { place: false, agent: 'Order Desk', output: text } }];
if (at < 0) return answer(out);

let order;
const rest = out.slice(at);
try { order = JSON.parse(rest.slice(rest.indexOf('{'), rest.lastIndexOf('}') + 1)); } catch (e) {
  return answer(\`\${reply}\\n\\nระบบอ่านรายการสั่งซื้อไม่ได้ กรุณายืนยันอีกครั้ง / Couldn't read the order, please confirm again.\`);
}
const txt = v => String(v ?? '').trim();
const num = v => (typeof v === 'number' ? v : txt(v) === '' ? NaN : Number(txt(v).replace(/[^0-9.-]/g, '')));
// the AI sometimes writes "SIBU‑084" with a special dash or space: compare SKUs in a plain form
const key = v => txt(v).normalize('NFKC').replace(/[\\u2010-\\u2015\\u2212\\uFE58\\uFE63\\uFF0D]/g, '-').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').replace(/\\s+/g, ' ').toUpperCase();
const sheet = new Map($('Get Products').all(0).map(i => i.json).filter(p => txt(p.sku)).map(p => [key(p.sku), p]));
const location = txt(order.location);
const wanted = new Map();
for (const i of Array.isArray(order.items) ? order.items : []) {
  const sku = key(i.sku);
  wanted.set(sku, (wanted.get(sku) ?? 0) + Math.floor(num(i.qty)));
}

const problems = [];
if (!location) problems.push('no front-store location');
if (!wanted.size) problems.push('no items');
const lines = [];
for (const [sku, qty] of wanted) {
  const p = sheet.get(sku);
  const stock = p ? num(p.stock_qty) || 0 : 0;
  if (!p) problems.push(\`\${sku} is not in the sheet\`);
  else if (!(qty >= 1)) problems.push(\`\${sku}: quantity must be 1 or more\`);
  else if (qty > stock) problems.push(\`\${sku} (\${txt(p.name)}) has only \${stock} in stock\`);
  else lines.push({ sku: txt(p.sku), name: txt(p.name), qty, price: num(p.price_ex_vat), new_stock: stock - qty });
}
if (problems.length) {
  return answer(\`\${reply}\\n\\nยังสั่งซื้อไม่ได้ / Can't place the order yet: \${problems.join('; ')}. กรุณาแก้ไขแล้วยืนยันอีกครั้ง / Please fix it and confirm again.\`);
}

const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
return [{ json: {
  place: true, agent: 'Order Desk',
  order_id: \`ORD-\${Date.now().toString(36).toUpperCase()}\`,
  location, lines,
  total_incl_vat: Math.round(subtotal * 1.07 * 100) / 100,
  session_id: $('Prepare Request').first(0).json.session_id,
} }];
`
    },
    position: [1740, 1000],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput'
  }
});

const place_Order = node({
  type: 'n8n-nodes-base.if',
  version: 2.3,
  config: { name: 'Place Order?', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }, conditions: [{ leftValue: expr('{{ $json.place }}'), rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } }, position: [1960, 1000], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 }
});

const split_Stock_Updates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Split Stock Updates',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `// One item per product: its SKU and the stock left after this order.
return $('Check Order').first(0).json.lines.map(l => ({ json: { sku: l.sku, stock_qty: l.new_stock } }));
`
    },
    position: [2180, 920],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000
  }
});

const update_Stock = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: { name: 'Update Stock', parameters: { resource: 'sheet', operation: 'update', authentication: 'oAuth2', documentId: { __rl: true, mode: 'id', value: expr('{{ String($(\'Get Products\').params.documentId.value ?? \'\').match(/[-\\w]{25,}/)?.[0] ?? \'\' }}') }, sheetName: { __rl: true, mode: 'name', value: 'Inventory' }, columns: { mappingMode: 'defineBelow', value: { sku: expr('{{ $json.sku }}'), stock_qty: expr('{{ $json.stock_qty }}') }, matchingColumns: ['sku'], schema: [{ id: 'sku', displayName: 'sku', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'stock_qty', displayName: 'stock_qty', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true }] }, options: {} }, credentials: { googleSheetsOAuth2Api: newCredential('Google Sheets account', 'aiEpt4MCfgtCCgZ1') }, position: [2400, 920], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, alwaysOutputData: true, onError: 'continueRegularOutput' }
});

const log_Order = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: { name: 'Log Order', parameters: { resource: 'sheet', operation: 'append', authentication: 'oAuth2', documentId: { __rl: true, mode: 'id', value: expr('{{ String($(\'Get Products\').params.documentId.value ?? \'\').match(/[-\\w]{25,}/)?.[0] ?? \'\' }}') }, sheetName: { __rl: true, mode: 'name', value: 'Orders' }, columns: { mappingMode: 'defineBelow', value: { order_id: expr('{{ $(\'Check Order\').first(0).json.order_id }}'), date: expr('{{ $now.toFormat(\'yyyy-MM-dd HH:mm\') }}'), store_location: expr('{{ $(\'Check Order\').first(0).json.location }}'), items: expr('{{ $(\'Check Order\').first(0).json.lines.map(l => l.sku + \' x\' + l.qty).join(\', \') }}'), total_incl_vat: expr('{{ $(\'Check Order\').first(0).json.total_incl_vat }}'), session_id: expr('{{ $(\'Check Order\').first(0).json.session_id }}') }, schema: [{ id: 'order_id', displayName: 'order_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'date', displayName: 'date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'store_location', displayName: 'store_location', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'items', displayName: 'items', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }, { id: 'total_incl_vat', displayName: 'total_incl_vat', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true }, { id: 'session_id', displayName: 'session_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }] }, options: {} }, credentials: { googleSheetsOAuth2Api: newCredential('Google Sheets account', 'aiEpt4MCfgtCCgZ1') }, position: [2620, 920], executeOnce: true, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, alwaysOutputData: true, onError: 'continueRegularOutput' }
});

const order_Confirmation = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Order Confirmation',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `// Tell the front store the order is placed, and warn if a sheet update failed.
const o = $('Check Order').first(0).json;
const stockFailed = $('Update Stock').all(0).filter(i => i.json?.error).length;
const logFailed = $('Log Order').all(0).some(i => i.json?.error);
const money = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let text = [
  \`✅ สั่งซื้อเรียบร้อย / Order placed: \${o.order_id}\`,
  \`ส่งที่ / Deliver to: \${o.location}\`,
  ...o.lines.map(l => \`• \${l.sku} \${l.name} x\${l.qty}\`),
  \`รวม / Total incl. VAT: ฿\${money(o.total_incl_vat)}\`,
].join('\\n');
if (stockFailed) text += \`\\n⚠️ ตัดสต็อกไม่สำเร็จ \${stockFailed} รายการ กรุณาตรวจสอบในชีต / \${stockFailed} stock update(s) failed, please check the sheet.\`;
if (logFailed) text += '\\n⚠️ บันทึกลงแท็บ Orders ไม่สำเร็จ / Could not save the order in the Orders tab.';
return [{ json: { agent: 'Order Desk', output: text } }];
`
    },
    position: [2840, 920],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput'
  }
});

const reply_to_Website = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: { name: 'Reply to Website', parameters: { respondWith: 'json', responseBody: expr('{{ JSON.stringify({ ok: true, agent: $json.agent || $prevNode.name, reply: $json.output || \'ขออภัยครับ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง / Sorry, something went wrong. Please try again.\' }) }}'), options: { responseCode: 200 } }, position: [1880, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 1000 }
});

const calculator = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Calculator',
    parameters: {
      promptType: 'define',
      text: expr('{{ $(\'Prepare Request\').first(0).json.message }}'),
      needsFallback: true,
      options: {
              systemMessage: expr(`You are the Calculator of {{ $('Store Info').first(0).json.store_name }}, a computer-hardware store in Thailand. Reply in the customer's language (Thai or English), short and clear.
Work out prices, totals and VAT for the products and quantities the customer asks about. Use the Calculator Tool for every sum; never calculate in your head. Use the price before VAT from PRODUCTS, then add VAT 7%.
Show each line (name x qty = amount), the subtotal before VAT, VAT 7% and the total, in baht with 2 decimals.
Say if a product is SOLD OUT or has less stock than asked. Only use products from PRODUCTS; if a product isn't there, say you can't find it.

PRODUCTS (sku | name | category | price | stock | tags | description):
{{ $('Prepare Request').first(0).json.products_text }}`),
              maxIterations: 8,
              enableStreaming: false
            }
    },
    position: [1500, 120],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    subnodes: { model: [groq_main_model, gemini_backup_model], memory: chat_Memory, tools: [calculator_Tool] }
  }
});

const troubleshooter = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Troubleshooter',
    parameters: {
      promptType: 'define',
      text: expr('{{ $(\'Prepare Request\').first(0).json.message }}'),
      needsFallback: true,
      options: {
              systemMessage: expr(`You are the Troubleshooter of {{ $('Store Info').first(0).json.store_name }}, a computer-hardware store in Thailand. Reply in the customer's language (Thai or English), short and friendly.
Help with product problems, setup, drivers, warranty, returns, orders and delivery. Give short numbered steps. Base product-specific steps on that product's description in PRODUCTS; don't guess from other brands.
For warranty, returns, opening hours and contact, use only STORE INFO. If the steps don't fix it, or it needs a repair, return or order check, ask the customer to contact the staff: {{ $('Store Info').first(0).json.contact }}.

STORE INFO:
Hours: {{ $('Store Info').first(0).json.hours }}
Policies: {{ $('Store Info').first(0).json.policies }}
Contact: {{ $('Store Info').first(0).json.contact }}

PRODUCTS (sku | name | category | price | stock | tags | description):
{{ $('Prepare Request').first(0).json.products_text }}`),
              maxIterations: 3,
              enableStreaming: false
            }
    },
    position: [1500, 300],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    subnodes: { model: [groq_main_model, gemini_backup_model], memory: chat_Memory }
  }
});

const hardware_Expert = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Hardware Expert',
    parameters: {
      promptType: 'define',
      text: expr('{{ $(\'Prepare Request\').first(0).json.message }}'),
      needsFallback: true,
      options: {
              systemMessage: expr(`You are the Hardware Expert of {{ $('Store Info').first(0).json.store_name }}, a computer-hardware store in Thailand. Reply in the customer's language (Thai or English), short and friendly.
Recommend products that fit what the customer will use them for (competitive gaming, casual gaming, office or study, design, video editing). Give the price incl. VAT and say if it is in stock. Only use products from PRODUCTS; never invent products, specs or prices.
For PC parts, check that they fit together using the descriptions (CPU socket = motherboard socket, RAM type = motherboard memory type, enough power supply watts for the graphics card) and mention it.
SOLD-OUT RULE: if the product the customer wants is SOLD OUT, say so and first ask what they will use it for (for example FPS/MOBA gaming, office work, design). Do not recommend anything yet. When they answer, recommend 1-3 IN-STOCK products that fit that use, each with one short trade-off compared with the product they wanted.

PRODUCTS (sku | name | category | price | stock | tags | description):
{{ $('Prepare Request').first(0).json.products_text }}`),
              maxIterations: 3,
              enableStreaming: false
            }
    },
    position: [1500, 480],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    subnodes: { model: [groq_main_model, gemini_backup_model], memory: chat_Memory }
  }
});

const when_This_Workflow_Fails = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: { name: 'When This Workflow Fails', position: [0, 820] }
});

const email_Alert = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Email Alert',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: placeholder('Email address that should receive alerts'),
      subject: expr('{{ \'[Store alert] \' + $json.workflow.name }}'),
      emailType: 'text',
      message: expr(`{{ $json.execution.error.message }}
Step: {{ $json.execution.lastNodeExecuted }}
Open: {{ $json.execution.url }}`),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: newCredential('Gmail account', 'oDZaXI1qofa3HUa3') },
    position: [240, 820],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000
  }
});

const wf = workflow('store-chat', 'IT Warehouse - Store Chat', { executionOrder: 'v1', executionTimeout: 120, saveDataErrorExecution: 'all' });

export default wf
  .add(webhook)
  .to(store_Info)
  .to(get_Products)
  .to(prepare_Request)
  .to(router)
  .to(route.onCase(0, order_Desk
    .to(check_Order)
    .to(place_Order.onTrue(split_Stock_Updates
      .to(update_Stock)
      .to(log_Order)
      .to(order_Confirmation)
      .to(reply_to_Website)).onFalse(reply_to_Website))).onCase(1, calculator
    .to(reply_to_Website)).onCase(2, troubleshooter
    .to(reply_to_Website)).onCase(3, hardware_Expert
    .to(reply_to_Website)))
  .add(when_This_Workflow_Fails)
  .to(email_Alert)
  .add(sticky(`## IT Warehouse - Store Chat

The website sends **POST /webhook/store-assistant** with \`{ "session_id": "...", "message": "..." }\` (for a sold-out product page: \`product_sku\` and no message).
It answers \`{ "ok": true, "agent": "...", "reply": "..." }\`.

- **Router** picks Hardware Expert, Calculator or Troubleshooter.
- Every AI Agent uses **Groq** first and switches to **Gemini** if Groq fails.
- Every step has **Retry On Fail** (3 tries). If an agent still fails, the customer gets a polite "please try again".
- **Get Products** reads your Google Sheet (tab **Inventory**) on every message, so changes show up right away.
- If the workflow crashes, **Email Alert** tells you.

**Edit me:** your Google Sheet in **Get Products**, your details in **Store Info**, your email in **Email Alert**.`, [webhook, store_Info], { name: 'Sticky Note 1b30f9ec', color: 5, width: 384, height: 224, position: [-32, 208] }))