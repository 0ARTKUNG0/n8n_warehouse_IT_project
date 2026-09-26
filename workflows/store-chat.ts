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
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Get Products',
    parameters: { resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'list', value: 'xgTZJDsEG067UvCX', cachedResultName: 'inventory' }, returnAll: true },
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
    parameters: { mode: 'runOnceForAllItems', jsCode: "// Read the website's request and turn the product list into text for the AI.\nconst body = $('Webhook').first(0).json.body ?? {};\nconst txt = v => String(v ?? '').trim();\nconst session_id = txt(body.session_id) || 'guest';\nconst sku = txt(body.product_sku).toUpperCase();\n// opened from a sold-out product page with no message yet\nconst message = txt(body.message).slice(0, 1000) || (sku ? `สินค้า ${sku} หมด ช่วยแนะนำตัวอื่นให้หน่อย` : 'สวัสดี');\n\nconst money = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });\nconst products = $input.all().map(i => i.json).filter(p => p.sku);\nconst products_text = products.map(p => [\n  p.sku, p.name, p.category,\n  `฿${money(p.price_ex_vat)} before VAT, ฿${money(p.price_ex_vat * 1.07)} incl. VAT`,\n  p.stock_qty > 0 ? `in stock: ${p.stock_qty}` : 'SOLD OUT',\n  `tags: ${txt(p.tags)}`,\n  txt(p.description).slice(0, 250),\n].join(' | ')).join('\\n') || 'The product list is not available right now. Do not name any products.';\n\nreturn [{ json: { session_id, message, products_text } }];\n" },
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
        systemMessage: expr("You are the Hardware Expert of {{ $('Store Info').first(0).json.store_name }}, a computer-hardware store in Thailand. Reply in the customer's language (Thai or English), short and friendly.\nRecommend products that fit what the customer will use them for (competitive gaming, casual gaming, office or study, design). Give the price incl. VAT and say if it is in stock. Only use products from PRODUCTS; never invent products, specs or prices.\nSOLD-OUT RULE: if the product the customer wants is SOLD OUT, say so and first ask what they will use it for (for example FPS/MOBA gaming, office work, design). Do not recommend anything yet. When they answer, recommend 1-3 IN-STOCK products that fit that use, each with one short trade-off compared with the product they wanted.\n\nPRODUCTS (sku | name | category | price | stock | tags | description):\n{{ $('Prepare Request').first(0).json.products_text }}"),
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

const note = sticky("## IT Warehouse - Store Chat\n\nThe website sends **POST /webhook/store-assistant** with `{ \"session_id\": \"...\", \"message\": \"...\" }` (for a sold-out product page: `product_sku` and no message).\nIt answers `{ \"ok\": true, \"agent\": \"...\", \"reply\": \"...\" }`.\n\n- **Router** picks Hardware Expert, Calculator or Troubleshooter.\n- Every AI Agent uses **Groq** first and switches to **Gemini** if Groq fails.\n- Every step has **Retry On Fail** (3 tries). If an agent still fails, the customer gets a polite \"please try again\".\n- If the workflow crashes, **Email Alert** tells you.\n\n**Edit me:** your details in **Store Info**, your email in **Email Alert**.", [webhook, storeInfo], { color: 5 });

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
