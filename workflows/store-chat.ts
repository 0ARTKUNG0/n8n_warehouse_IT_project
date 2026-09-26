import { workflow, node, trigger, switchCase, languageModel, memory, tool, sticky, expr, placeholder } from '@n8n/workflow-sdk';

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: { name: 'Webhook', parameters: { httpMethod: 'POST', path: 'store-assistant', responseMode: 'responseNode', options: {} }, position: [0, 300] },
  output: [{ body: { session_id: 'abc123', message: 'แนะนำเมาส์เล่นเกม FPS หน่อย' } }]
});

const storeInfo = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Store Info',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: { assignments: [
        { id: 'store-name', name: 'store_name', value: 'IT Warehouse', type: 'string' },
        { id: 'contact', name: 'contact', value: 'หน้า "ติดต่อเรา" บนเว็บไซต์', type: 'string' },
        { id: 'hours', name: 'hours', value: 'ดูเวลาทำการได้ที่หน้าเว็บไซต์', type: 'string' },
        { id: 'policies', name: 'policies', value: 'เรื่องการรับประกัน การเปลี่ยนหรือคืนสินค้า ให้ติดต่อพนักงาน', type: 'string' }
      ] }
    },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    position: [220, 300]
  },
  output: [{ store_name: 'IT Warehouse', contact: 'LINE @itwarehouse', hours: '10:00-20:00', policies: '' }]
});

const getProducts = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Get Products',
    parameters: {
      resource: 'sheet', operation: 'read', authentication: 'oAuth2',
      documentId: { __rl: true, mode: 'list', value: '', cachedResultName: 'inventory' },
      sheetName: { __rl: true, mode: 'name', value: 'Inventory' },
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: { id: 'aiEpt4MCfgtCCgZ1', name: 'Google Sheets account' } },
    alwaysOutputData: true, executeOnce: true,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    position: [440, 300]
  },
  output: [{ sku: 'MS-002', name: 'Veltra V1 Wired Gaming Mouse', category: 'mouse', price_ex_vat: 1390, stock_qty: 25, tags: 'gaming,wired', description: '' }]
});

const prepare = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Request',
    parameters: { mode: 'runOnceForAllItems', jsCode: "// Read the website's request, pick the products that match the question (at most 30)\n// and turn them into text for the AI. The whole sheet is too big to send on every message.\nconst body = $('Webhook').first(0).json.body ?? {};\nconst txt = v => String(v ?? '').trim();\nconst num = v => (typeof v === 'number' ? v : txt(v) === '' ? NaN : Number(txt(v).replace(/[^0-9.-]/g, '')));\nconst session_id = txt(body.session_id) || 'guest';\nconst sku = txt(body.product_sku).toUpperCase();\n// opened from a sold-out product page with no message yet\nconst message = txt(body.message).slice(0, 1000) || (sku ? `สินค้า ${sku} หมด ช่วยแนะนำตัวอื่นให้หน่อย` : 'สวัสดี');\nconst m = message.toLowerCase();\n\n// rows with a missing sku, name or price are skipped\nconst products = $input.all().map(i => i.json)\n  .filter(p => txt(p.sku) && txt(p.name) && Number.isFinite(num(p.price_ex_vat)))\n  .map(p => ({ ...p, sku: txt(p.sku).toUpperCase(), category: txt(p.category).toLowerCase(), price: num(p.price_ex_vat), stock: num(p.stock_qty) || 0,\n               hay: ` ${txt(p.sku)} ${txt(p.name)} ${txt(p.tags)} ${txt(p.description)} `.toLowerCase() }))\n  .map(p => ({ ...p, hay2: p.hay.replace(/\\s+/g, '') }));  // \"16gb\" also finds \"16 GB\"\n\n// words that name a category, Thai and English\nconst CATEGORY_WORDS = {\n  gpu: ['การ์ดจอ', 'gpu', 'graphics card', 'rtx', 'gtx', 'radeon', 'geforce'],\n  cpu: ['ซีพียู', 'cpu', 'processor', 'ryzen', 'core i3', 'core i5', 'core i7', 'core i9', 'ultra 5', 'ultra 7'],\n  'cpu-cooler': ['ระบายความร้อน', 'ซิงค์', 'ชุดน้ำ', 'cooler', 'heatsink', 'aio'],\n  motherboard: ['เมนบอร์ด', 'เมนบอด', 'motherboard', 'mainboard'],\n  ram: ['แรม', 'ram', 'ddr4', 'ddr5'],\n  ssd: ['ssd', 'nvme', 'm.2'],\n  hdd: ['ฮาร์ดดิสก์', 'hdd', 'hard disk', 'harddisk'],\n  psu: ['พาวเวอร์', 'psu', 'power supply', 'วัตต์'],\n  case: ['เคส', 'case'],\n  monitor: ['จอ', 'นิ้ว', 'monitor', 'inch'],\n};\nconst esc = w => w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');\nconst has = (text, w) => /^[a-z0-9 .]+$/.test(w) ? new RegExp(`(^|[^a-z0-9])${esc(w)}([^a-z0-9]|$)`).test(text) : text.includes(w);\nconst STOP = new Set(['the', 'for', 'and', 'with', 'what', 'how', 'much', 'is', 'are', 'do', 'you', 'have', 'vat', 'price', 'total', 'buy', 'want', 'need', 'can', 'my', 'me', 'it', 'in', 'of', 'to', 'a', 'an', 'or', 'pc', 'gb', 'tb']);\n\nconst noGpu = m.replace(/การ์ดจอ/g, ' ');  // \"การ์ดจอ\" (graphics card) is not a monitor\nlet cats = Object.keys(CATEGORY_WORDS).filter(c => CATEGORY_WORDS[c].some(w => has(c === 'monitor' ? noGpu : m, w)));\nlet terms = (m.match(/[a-z0-9][a-z0-9.+-]*/g) ?? []).filter(t => t.length >= 2 && !STOP.has(t));\nconst asked = sku && products.find(p => p.sku === sku);\nif (asked) { cats = [...new Set([...cats, asked.category])]; terms = [...terms, sku.toLowerCase()]; }\n\n// a follow-up like \"for gaming\" names no product type: keep this chat's last search and add to it\nlet memo = { searches: {} };\ntry { memo = $getWorkflowStaticData('global'); memo.searches = memo.searches ?? {}; } catch (e) {}\nconst now = Date.now();\nfor (const [k, v] of Object.entries(memo.searches)) if (now - v.at > 24 * 3600e3) delete memo.searches[k];\nconst last = memo.searches[session_id];\nif (!cats.length && last) { cats = last.cats; terms = [...new Set([...last.terms, ...terms])].slice(-8); }\n// a word that only a few products have (a model like \"5600x\") counts more than a common one (\"ddr4\")\n// \"16gb\" or \"144hz\" may be written \"16 GB\" / \"144 Hz\" in the sheet; other words must match as they are\nconst found = (p, t) => p.hay.includes(t) || (/\\d/.test(t) && /[a-z]/.test(t) && p.hay2.includes(t));\nconst matches = p => terms.filter(t => found(p, t));\nconst df = Object.fromEntries(terms.map(t => [t, products.filter(p => found(p, t)).length]));\nconst score = p => matches(p).reduce((sum, t) => sum + 1 / df[t], 0);\nconst specific = p => matches(p).some(t => df[t] <= 20);\nconst scored = products.map(p => ({ p, s: score(p) }))\n  .filter(x => x.s > 0 && (!cats.length || cats.includes(x.p.category) || specific(x.p)))\n  .sort((a, b) => b.s - a.s || (b.p.stock > 0) - (a.p.stock > 0) || a.p.price - b.p.price);\n// best matches, taking turns between product types so \"CPU and RAM\" gets both\nconst groups = new Map();\nfor (const { p } of scored) { if (!groups.has(p.category)) groups.set(p.category, []); groups.get(p.category).push(p); }\nlet picks = [];\nwhile (picks.length < 16 && [...groups.values()].some(g => g.length)) {\n  for (const g of groups.values()) if (g.length && picks.length < 16) picks.push(g.shift());\n}\n// in-stock alternatives of the same types: closest in price to the best match, or spread over all prices\nconst types = cats.length ? cats : [...new Set(picks.map(p => p.category))];\nconst each = Math.max(3, Math.floor((30 - picks.length) / Math.max(1, types.length)));\nfor (const type of types) {\n  const anchor = picks.find(p => p.category === type)?.price;\n  let pool = products.filter(p => p.category === type && p.stock > 0 && !picks.includes(p));\n  if (anchor !== undefined) pool.sort((a, b) => Math.abs(a.price - anchor) - Math.abs(b.price - anchor));\n  else { pool.sort((a, b) => a.price - b.price); const step = pool.length / each; pool = Array.from({ length: Math.min(each, pool.length) }, (_, i) => pool[Math.floor(i * step)]); }\n  picks.push(...pool.slice(0, each));\n}\npicks = picks.slice(0, 30);\nif (!picks.length) {\n  // nothing named yet (\"hello\"): a few in-stock products from every category\n  const byCat = {};\n  for (const p of products.filter(p => p.stock > 0).sort((a, b) => a.price - b.price)) (byCat[p.category] ??= []).push(p);\n  picks = Object.values(byCat).flatMap(list => list.slice(0, 3)).slice(0, 30);\n}\nif (terms.length || cats.length) memo.searches[session_id] = { terms, cats, at: now };\n\nconst money = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });\nconst lines = picks.map(p => [\n  p.sku, txt(p.name), p.category,\n  `฿${money(p.price)} before VAT, ฿${money(p.price * 1.07)} incl. VAT`,\n  p.stock > 0 ? `in stock: ${p.stock}` : 'SOLD OUT',\n  `tags: ${txt(p.tags)}`,\n  txt(p.description).slice(0, 250),\n].join(' | '));\nconst products_text = products.length\n  ? `(The store has ${products.length} products; these ${lines.length} match this question best. If what the customer wants isn't listed, ask for the exact model or type instead of saying the store doesn't have it.)\\n${lines.join('\\n')}`\n  : 'The product list is not available right now. Do not name any products.';\n\nreturn [{ json: { session_id, message, products_text } }];\n" },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    position: [660, 300]
  },
  output: [{ session_id: 'abc123', message: 'แนะนำเมาส์เล่นเกม FPS หน่อย', products_text: 'MS-002 | Veltra V1 Wired Gaming Mouse | mouse | ฿1,390.00 before VAT, ฿1,487.30 incl. VAT | in stock: 25' }]
});

const groq = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGroq',
  version: 1,
  config: {
    name: 'Groq (main model)',
    parameters: { model: 'openai/gpt-oss-120b', options: { temperature: 0.3, maxTokensToSample: 2048 } },
    credentials: { groqApi: { id: 'fk0N9mxbYr8EqEaP', name: 'Groq account' } },
    position: [900, 560]
  }
});

const gemini = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
  version: 1.1,
  config: {
    name: 'Gemini (backup model)',
    parameters: { modelName: 'models/gemini-flash-latest', options: { temperature: 0.3, maxOutputTokens: 2048 } },
    credentials: { googlePalmApi: { id: 'iEXJevGkgXLcbG0R', name: 'Google Gemini(PaLM) Api account' } },
    position: [1060, 560]
  }
});

const chatMemory = memory({
  type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
  version: 1.4,
  config: {
    name: 'Chat Memory',
    parameters: { sessionIdType: 'customKey', sessionKey: expr("{{ $('Prepare Request').first(0).json.session_id }}"), contextWindowLength: 8 },
    position: [1500, 700]
  }
});

const calculatorTool = tool({
  type: '@n8n/n8n-nodes-langchain.toolCalculator',
  version: 1,
  config: { name: 'Calculator Tool', parameters: {}, position: [1660, 700] }
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
        systemMessage: "Classify the customer's message for a computer-hardware store. Answer with exactly one word:\nhardware = questions about products, recommendations, specs, stock, sold-out products, or the customer telling what they will use a product for\ncalculator = prices for quantities, totals, VAT, quotations\ntroubleshooter = problems, setup, drivers, warranty, returns, orders, delivery\nIf unsure, answer hardware.",
        maxIterations: 3,
        enableStreaming: false
      }
    },
    subnodes: { model: [groq, gemini] },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    position: [900, 300]
  },
  output: [{ output: 'hardware' }]
});

const route = switchCase({
  version: 3.4,
  config: {
    name: 'Route',
    parameters: {
      mode: 'rules',
      rules: { values: [
        { outputKey: 'calculator', renameOutput: true, conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr('{{ $json.output }}'), rightValue: 'calculator', operator: { type: 'string', operation: 'contains' } }], combinator: 'and' } },
        { outputKey: 'troubleshooter', renameOutput: true, conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr('{{ $json.output }}'), rightValue: 'troubleshoot', operator: { type: 'string', operation: 'contains' } }], combinator: 'and' } }
      ] },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'hardware' }
    },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    position: [1140, 300]
  }
});

const calculator = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Calculator',
    parameters: {
      promptType: 'define',
      text: expr("{{ $('Prepare Request').first(0).json.message }}"),
      needsFallback: true,
      options: {
        systemMessage: expr("You are the Calculator of {{ $('Store Info').first(0).json.store_name }}, a computer-hardware store in Thailand. Reply in the customer's language (Thai or English), short and clear.\nWork out prices, totals and VAT for the products and quantities the customer asks about. Use the Calculator Tool for every sum; never calculate in your head. Use the price before VAT from PRODUCTS, then add VAT 7%.\nShow each line (name x qty = amount), the subtotal before VAT, VAT 7% and the total, in baht with 2 decimals.\nSay if a product is SOLD OUT or has less stock than asked. Only use products from PRODUCTS; if a product isn't there, say you can't find it.\n\nPRODUCTS (sku | name | category | price | stock | tags | description):\n{{ $('Prepare Request').first(0).json.products_text }}"),
        maxIterations: 8,
        enableStreaming: false
      }
    },
    subnodes: { model: [groq, gemini], memory: chatMemory, tools: [calculatorTool] },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    position: [1500, 120]
  },
  output: [{ output: 'รวมทั้งสิ้น ฿2,974.60' }]
});

const troubleshooter = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Troubleshooter',
    parameters: {
      promptType: 'define',
      text: expr("{{ $('Prepare Request').first(0).json.message }}"),
      needsFallback: true,
      options: {
        systemMessage: expr("You are the Troubleshooter of {{ $('Store Info').first(0).json.store_name }}, a computer-hardware store in Thailand. Reply in the customer's language (Thai or English), short and friendly.\nHelp with product problems, setup, drivers, warranty, returns, orders and delivery. Give short numbered steps. Base product-specific steps on that product's description in PRODUCTS; don't guess from other brands.\nFor warranty, returns, opening hours and contact, use only STORE INFO. If the steps don't fix it, or it needs a repair, return or order check, ask the customer to contact the staff: {{ $('Store Info').first(0).json.contact }}.\n\nSTORE INFO:\nHours: {{ $('Store Info').first(0).json.hours }}\nPolicies: {{ $('Store Info').first(0).json.policies }}\nContact: {{ $('Store Info').first(0).json.contact }}\n\nPRODUCTS (sku | name | category | price | stock | tags | description):\n{{ $('Prepare Request').first(0).json.products_text }}"),
        maxIterations: 3,
        enableStreaming: false
      }
    },
    subnodes: { model: [groq, gemini], memory: chatMemory },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    position: [1500, 300]
  },
  output: [{ output: '1. ลองเปลี่ยนพอร์ต USB' }]
});

const hardware = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Hardware Expert',
    parameters: {
      promptType: 'define',
      text: expr("{{ $('Prepare Request').first(0).json.message }}"),
      needsFallback: true,
      options: {
        systemMessage: expr("You are the Hardware Expert of {{ $('Store Info').first(0).json.store_name }}, a computer-hardware store in Thailand. Reply in the customer's language (Thai or English), short and friendly.\nRecommend products that fit what the customer will use them for (competitive gaming, casual gaming, office or study, design, video editing). Give the price incl. VAT and say if it is in stock. Only use products from PRODUCTS; never invent products, specs or prices.\nFor PC parts, check that they fit together using the descriptions (CPU socket = motherboard socket, RAM type = motherboard memory type, enough power supply watts for the graphics card) and mention it.\nSOLD-OUT RULE: if the product the customer wants is SOLD OUT, say so and first ask what they will use it for (for example FPS/MOBA gaming, office work, design). Do not recommend anything yet. When they answer, recommend 1-3 IN-STOCK products that fit that use, each with one short trade-off compared with the product they wanted.\n\nPRODUCTS (sku | name | category | price | stock | tags | description):\n{{ $('Prepare Request').first(0).json.products_text }}"),
        maxIterations: 3,
        enableStreaming: false
      }
    },
    subnodes: { model: [groq, gemini], memory: chatMemory },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    position: [1500, 480]
  },
  output: [{ output: 'แนะนำ Veltra V1 Wired Gaming Mouse ครับ' }]
});

const reply = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Reply to Website',
    parameters: {
      respondWith: 'json',
      responseBody: expr("{{ JSON.stringify({ ok: true, agent: $prevNode.name, reply: $json.output || 'ขออภัยครับ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง / Sorry, something went wrong. Please try again.' }) }}"),
      options: { responseCode: 200 }
    },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 1000,
    position: [1880, 300]
  },
  output: [{ ok: true }]
});

const errorTrigger = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: { name: 'When This Workflow Fails', position: [0, 820] },
  output: [{ execution: { id: '1', url: '', error: { message: 'Something failed' }, lastNodeExecuted: 'Router' }, workflow: { name: 'IT Warehouse - Store Chat' } }]
});

const emailAlert = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Email Alert',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: placeholder('Email address that should receive alerts'),
      subject: expr("{{ '[Store alert] ' + $json.workflow.name }}"),
      emailType: 'text',
      message: expr("{{ $json.execution.error.message }}\nStep: {{ $json.execution.lastNodeExecuted }}\nOpen: {{ $json.execution.url }}"),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'oDZaXI1qofa3HUa3', name: 'Gmail account' } },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    position: [240, 820]
  },
  output: [{ id: 'msg' }]
});

const note = sticky("## IT Warehouse - Store Chat\n\nThe website sends **POST /webhook/store-assistant** with `{ \"session_id\": \"...\", \"message\": \"...\" }` (for a sold-out product page: `product_sku` and no message).\nIt answers `{ \"ok\": true, \"agent\": \"...\", \"reply\": \"...\" }`.\n\n- **Router** picks Hardware Expert, Calculator or Troubleshooter.\n- Every AI Agent uses **Groq** first and switches to **Gemini** if Groq fails.\n- Every step has **Retry On Fail** (3 tries). If an agent still fails, the customer gets a polite \"please try again\".\n- **Get Products** reads your Google Sheet (tab **Inventory**) on every message, so changes show up right away.\n- If the workflow crashes, **Email Alert** tells you.\n\n**Edit me:** your Google Sheet in **Get Products**, your details in **Store Info**, your email in **Email Alert**.", [webhook, storeInfo], { color: 5 });

export default workflow('store-chat', 'IT Warehouse - Store Chat', { settings: { executionOrder: 'v1', executionTimeout: 120, saveDataErrorExecution: 'all' } })
  .add(webhook)
  .to(storeInfo)
  .to(getProducts)
  .to(prepare)
  .to(router)
  .to(route.onCase(0, calculator).onCase(1, troubleshooter).onCase(2, hardware))
  .add(calculator)
  .to(reply)
  .add(troubleshooter)
  .to(reply)
  .add(hardware)
  .to(reply)
  .add(errorTrigger)
  .to(emailAlert)
  .add(note);
