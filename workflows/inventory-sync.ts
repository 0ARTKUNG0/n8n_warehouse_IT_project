import { workflow, node, trigger, sticky, expr, placeholder } from '@n8n/workflow-sdk';

const every5min = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.2,
  config: { name: 'Every 5 Minutes', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }, position: [0, 200] },
  output: [{}]
});

const syncNow = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Sync Now', position: [0, 400] },
  output: [{}]
});

const findFile = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Find inventory.xlsx',
    parameters: {
      resource: 'fileFolder', operation: 'search',
      searchMethod: 'query',
      queryString: "name = 'inventory.xlsx' and trashed = false",
      returnAll: false, limit: 1,
      filter: { whatToSearch: 'files' },
      options: { fields: ['id', 'name'] }
    },
    credentials: { googleDriveOAuth2Api: { id: 'w5G4HPgVcRe5OMeK', name: 'Google Drive account' } },
    alwaysOutputData: true, executeOnce: true,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    position: [240, 300]
  },
  output: [{ id: 'file-id', name: 'inventory.xlsx' }]
});

const downloadFile = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Download File',
    parameters: { resource: 'file', operation: 'download', fileId: { __rl: true, mode: 'id', value: expr('{{ $json.id }}') }, options: { binaryPropertyName: 'data' } },
    credentials: { googleDriveOAuth2Api: { id: 'w5G4HPgVcRe5OMeK', name: 'Google Drive account' } },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    position: [480, 300]
  },
  output: [{ id: 'file-id', name: 'inventory.xlsx' }]
});

const readRows = node({
  type: 'n8n-nodes-base.extractFromFile',
  version: 1.1,
  config: {
    name: 'Read Excel Rows',
    parameters: { operation: 'xlsx', binaryPropertyName: 'data', options: { sheetName: 'Inventory', headerRow: true, includeEmptyCells: true } },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    position: [720, 300]
  },
  output: [{ sku: 'MS-001', name: 'Mouse', category: 'mouse', price_ex_vat: 100, stock_qty: 1, image_url: '', description: '', tags: '' }]
});

const cleanRows = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Clean Rows',
    parameters: { mode: 'runOnceForAllItems', jsCode: "// Keep only rows that are complete and correct. A row with a mistake is skipped,\n// so that product keeps its last good values in the store.\nconst txt = v => String(v ?? '').trim();\nconst num = v => (typeof v === 'number' ? v : txt(v) === '' ? NaN : Number(txt(v).replace(/บาท|thb|฿|,|\\s/gi, '')));\nconst seen = new Set();\nconst rows = [];\nfor (const { json: r } of $input.all()) {\n  const p = {\n    sku: txt(r.sku).toUpperCase(),\n    name: txt(r.name),\n    category: txt(r.category).toLowerCase(),\n    price_ex_vat: Math.round(num(r.price_ex_vat) * 100) / 100,\n    stock_qty: num(r.stock_qty),\n    image_url: txt(r.image_url),\n    description: txt(r.description).slice(0, 1000),\n    tags: txt(r.tags).toLowerCase(),\n  };\n  const ok = p.sku && p.name && !seen.has(p.sku)\n    && Number.isFinite(p.price_ex_vat) && p.price_ex_vat >= 0\n    && Number.isInteger(p.stock_qty) && p.stock_qty >= 0;\n  if (!ok) continue;\n  seen.add(p.sku);\n  rows.push({ json: p });\n}\n// an empty or wrong file must not look like a successful sync\nif (!rows.length) throw new Error('No valid product rows in the Inventory sheet');\nreturn rows;\n" },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    position: [960, 300]
  },
  output: [{ sku: 'MS-001', name: 'Mouse', category: 'mouse', price_ex_vat: 100, stock_qty: 1, image_url: '', description: '', tags: '' }]
});

const saveProducts = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save Products',
    parameters: {
      resource: 'row', operation: 'upsert', dataTableId: { __rl: true, mode: 'list', value: 'xgTZJDsEG067UvCX', cachedResultName: 'inventory' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'sku', condition: 'eq', keyValue: expr('{{ $json.sku }}') }] },
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [
        { id: 'sku', displayName: 'sku', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        { id: 'name', displayName: 'name', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        { id: 'category', displayName: 'category', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        { id: 'price_ex_vat', displayName: 'price_ex_vat', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
        { id: 'stock_qty', displayName: 'stock_qty', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
        { id: 'image_url', displayName: 'image_url', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        { id: 'description', displayName: 'description', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        { id: 'tags', displayName: 'tags', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
      ] }
    },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    position: [1200, 300]
  },
  output: [{ id: 1, sku: 'MS-001' }]
});

const errorTrigger = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: { name: 'When This Workflow Fails', position: [0, 620] },
  output: [{ execution: { id: '1', url: '', error: { message: 'Something failed' }, lastNodeExecuted: 'Download File' }, workflow: { name: 'IT Warehouse - Inventory Sync' } }]
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
      message: expr("{{ $json.execution.error.message }}\nStep: {{ $json.execution.lastNodeExecuted }}\nOpen: {{ $json.execution.url }}\n\nThe chat keeps using the last good product list."),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'oDZaXI1qofa3HUa3', name: 'Gmail account' } },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    position: [240, 620]
  },
  output: [{ id: 'msg' }]
});

const note = sticky("## IT Warehouse - Inventory Sync\n\nEvery 5 minutes: **inventory.xlsx** on Google Drive (sheet **Inventory**) → the **inventory** data table the Store Chat answers from.\n\n- A row with a mistake (no sku or name, bad price or stock) is skipped; that product keeps its last good values.\n- Every step has **Retry On Fail**. If it still fails, **Email Alert** tells you and the chat keeps the last good list.\n- To take a product off sale, set its stock_qty to 0.\n\n**Edit me:** your email in **Email Alert**.", [every5min, syncNow], { color: 5 });

export default workflow('inventory-sync-simple', 'IT Warehouse - Inventory Sync', { settings: { executionOrder: 'v1', executionTimeout: 240, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'none' } })
  .add(every5min)
  .to(findFile)
  .add(syncNow)
  .to(findFile)
  .add(findFile)
  .to(downloadFile)
  .to(readRows)
  .to(cleanRows)
  .to(saveProducts)
  .add(errorTrigger)
  .to(emailAlert)
  .add(note);
