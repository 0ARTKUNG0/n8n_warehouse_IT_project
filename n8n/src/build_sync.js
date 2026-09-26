// Generates the n8n Workflow SDK code for the Inventory Sync workflow (Excel on Google Drive -> inventory data table).
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, 'sync', f), 'utf8');
const js = s => JSON.stringify(s);

const INVENTORY = `{ __rl: true, mode: 'list', value: 'xgTZJDsEG067UvCX', cachedResultName: 'inventory' }`;
const STATUS = `{ __rl: true, mode: 'list', value: '4vK0pu7qvVs1DUZg', cachedResultName: 'sync_status' }`;
const ERROR_HANDLER = `{ __rl: true, mode: 'list', value: 'TMxtguyRFd087DPT', cachedResultName: 'Error Handler (alerts and log)' }`;
const DRIVE_CRED = `{ googleDriveOAuth2Api: { id: 'w5G4HPgVcRe5OMeK', name: 'Google Drive account' } }`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const col = (id, type = 'string') => `{ id: '${id}', displayName: '${id}', required: false, defaultMatch: false, display: true, type: '${type}', canBeUsedToMatch: true }`;
const INVENTORY_SCHEMA = [col('sku'), col('name'), col('category'), col('price_ex_vat', 'number'), col('stock_qty', 'number'),
  col('image_url'), col('description'), col('tags')].join(', ');
const ifTrue = (v, name, left, x, y) => `
const ${v} = ifElse({
  version: 2.3,
  config: {
    name: '${name}',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr(${js(left)}), rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [${x}, ${y}]
  }
});
`;
const codeNode = (v, name, file, x, y, extra, output = '{}') => `
const ${v} = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: '${name}',
    parameters: { mode: 'runOnceForAllItems', jsCode: ${js(read(file))} },
    ${extra ? `${extra}\n    ` : ''}position: [${x}, ${y}]
  },
  output: [${output}]
});
`;

const code = `import { workflow, node, trigger, sticky, ifElse, expr } from '@n8n/workflow-sdk';

const every5min = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.2,
  config: { name: 'Every 5 Minutes', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }, position: [0, 300] },
  output: [{}]
});

const syncNow = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Sync Now', position: [0, 500] },
  output: [{}]
});

const syncSettings = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Sync Settings',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [
        { id: 'file-name', name: 'file_name', value: 'inventory.xlsx', type: 'string' },
        { id: 'sheet-name', name: 'sheet_name', value: 'Inventory', type: 'string' },
        { id: 'allow-big', name: 'allow_big_changes', value: false, type: 'boolean' }
      ] }
    },
    position: [240, 400]
  },
  output: [{ file_name: 'inventory.xlsx', sheet_name: 'Inventory', allow_big_changes: false }]
});

const loadLastStatus = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Last Status',
    parameters: {
      resource: 'row', operation: 'get', dataTableId: ${STATUS},
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'key', condition: 'eq', keyValue: 'inventory' }] },
      returnAll: false, limit: 1
    },
    alwaysOutputData: true, executeOnce: true,
    retryOnFail: true, maxTries: 2, waitBetweenTries: 1000,
    onError: 'continueRegularOutput',
    position: [480, 400]
  },
  output: [{ key: 'inventory', ok: true, message: 'Synced', problems_signature: '' }]
});

const readCurrent = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read Current Products',
    parameters: { resource: 'row', operation: 'get', dataTableId: ${INVENTORY}, returnAll: true },
    alwaysOutputData: true, executeOnce: true,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    position: [720, 400]
  },
  output: [{ sku: 'MS-001', name: 'Mouse', category: 'mouse', price_ex_vat: 100, stock_qty: 1, image_url: '', description: '', tags: '' }]
});

const findFile = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Find Excel File',
    parameters: {
      resource: 'fileFolder', operation: 'search',
      searchMethod: 'name',
      queryString: expr(${js("{{ $('Sync Settings').first(0).json.file_name.replace(/\\.xlsx$/i, '') }}")}),
      returnAll: false, limit: 50,
      filter: { whatToSearch: 'files', includeTrashed: false },
      options: { fields: ['*'] }
    },
    credentials: ${DRIVE_CRED},
    alwaysOutputData: true, executeOnce: true,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
    position: [960, 400]
  },
  output: [{ id: 'file-id', name: 'inventory.xlsx', mimeType: '${XLSX}', modifiedTime: '2026-09-01T00:00:00Z' }]
});
${codeNode('pickFile', 'Pick Inventory File', 'pick_file.js', 1200, 400, "onError: 'continueErrorOutput',", `{ id: 'file-id', name: 'inventory.xlsx', mimeType: '${XLSX}', modifiedTime: '', other_copies: 0 }`)}
const downloadFile = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Download File',
    parameters: {
      resource: 'file', operation: 'download',
      fileId: { __rl: true, mode: 'id', value: expr('{{ $json.id }}') },
      options: { binaryPropertyName: 'data', googleFileConversion: { conversion: { sheetsToFormat: '${XLSX}' } } }
    },
    credentials: ${DRIVE_CRED},
    retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    onError: 'continueErrorOutput',
    position: [1440, 400]
  },
  output: [{ id: 'file-id', name: 'inventory.xlsx' }]
});

const readRows = node({
  type: 'n8n-nodes-base.extractFromFile',
  version: 1.1,
  config: {
    name: 'Read Excel Rows',
    parameters: {
      operation: 'xlsx',
      binaryPropertyName: 'data',
      options: { sheetName: expr("{{ $('Sync Settings').first(0).json.sheet_name }}"), headerRow: true, includeEmptyCells: true }
    },
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    position: [1680, 400]
  },
  output: [{ sku: 'MS-001', name: 'Mouse', category: 'mouse', price_ex_vat: 100, stock_qty: 1, image_url: '', description: '', tags: '' }]
});
${codeNode('validate', 'Validate & Clean', 'validate_and_clean.js', 1920, 400, "onError: 'continueErrorOutput',", `{ safe: true, reason: '', upserts: [], removed: [], problems: [], problems_signature: '', products_in_file: 14, products_before: 14 }`)}
${ifTrue('safeToApply', 'Safe to Apply?', '{{ $json.safe }}', 2160, 400)}
${ifTrue('anyUpdates', 'Any Updates?', '{{ $json.upserts.length > 0 }}', 2400, 300)}
${codeNode('splitUpdates', 'Split Updates', 'split_upserts.js', 2640, 200, '', `{ sku: 'MS-001', name: 'Mouse', category: 'mouse', price_ex_vat: 100, stock_qty: 1, image_url: '', description: '', tags: '' }`)}
const saveProduct = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save Product',
    parameters: {
      resource: 'row', operation: 'upsert', dataTableId: ${INVENTORY},
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'sku', condition: 'eq', keyValue: expr('{{ $json.sku }}') }] },
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [${INVENTORY_SCHEMA}] }
    },
    alwaysOutputData: true,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    position: [2880, 200]
  },
  output: [{ id: 1, sku: 'MS-001' }]
});
${codeNode('savesDone', 'Saves Done', 'saves_done.js', 3120, 300, '', `{ saved: 1, save_failed: 0, save_failures: [] }`)}
${ifTrue('anyRemovals', 'Any Removals?', "{{ $('Validate & Clean').first(0).json.removed.length > 0 }}", 3360, 300)}
${codeNode('splitRemovals', 'Split Removals', 'split_removals.js', 3600, 200, '', `{ sku: 'MS-001' }`)}
const deleteProduct = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Delete Product',
    parameters: {
      resource: 'row', operation: 'deleteRows', dataTableId: ${INVENTORY},
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'sku', condition: 'eq', keyValue: expr('{{ $json.sku }}') }] }
    },
    alwaysOutputData: true,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    position: [3840, 200]
  },
  output: [{ id: 1, sku: 'MS-001' }]
});
${codeNode('removalsDone', 'Removals Done', 'removals_done.js', 4080, 300, '', `{ saved: 1, deleted: 0, save_failed: 0, delete_failed: 0 }`)}
${codeNode('recordResult', 'Record Result', 'record_result.js', 4320, 500, '', `{ ok: true, fails: 0, down_alerted: false, message: 'Synced', problems_signature: '', alert: false, alert_subject: '', alert_detail: '' }`)}
const saveStatus = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save Status',
    parameters: {
      resource: 'row', operation: 'upsert', dataTableId: ${STATUS},
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'key', condition: 'eq', keyValue: 'inventory' }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          key: 'inventory', ok: expr('{{ $json.ok }}'), message: expr('{{ $json.message }}'), problems_signature: expr('{{ $json.problems_signature }}'),
          fails: expr('{{ $json.fails }}'), down_alerted: expr('{{ $json.down_alerted }}')
        },
        matchingColumns: [],
        schema: [${col('key')}, ${col('ok', 'boolean')}, ${col('message')}, ${col('problems_signature')}, ${col('fails', 'number')}, ${col('down_alerted', 'boolean')}]
      }
    },
    alwaysOutputData: true,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    position: [4560, 500]
  },
  output: [{ id: 1, key: 'inventory', ok: true }]
});
${ifTrue('alertOwner', 'Alert Owner?', "{{ $('Record Result').first(0).json.alert }}", 4800, 500)}
${codeNode('alertPayload', 'Alert Payload', 'alert_payload.js', 5040, 420, '', `{ workflow_name: 'Inventory Sync', message: 'Inventory sync stopped', detail: '' }`)}
const sendAlert = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Send Alert',
    parameters: { mode: 'once', source: 'database', workflowId: ${ERROR_HANDLER}, options: { waitForSubWorkflow: false } },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    position: [5280, 420]
  },
  output: [{}]
});

const note = sticky(${js(`## Inventory Sync: Excel on Google Drive -> store product list

Every 5 minutes this reads **inventory.xlsx** (or a Google Sheet named **inventory**) from Google Drive, sheet **Inventory**, and updates the **inventory** data table that the Store Assistant answers from.

**The chat never reads Google Drive directly.** If Drive is down, the file is missing or a cell is wrong, customers keep getting answers from the last good product list.

- Rows with mistakes (missing price, text in a number cell) are skipped, and the product keeps its last good version.
- A file with far fewer products than the store has (wrong file or sheet) is not applied. If the change is intended, set **allow_big_changes** in **Sync Settings** to true, run **Sync Now** once, then set it back to false.
- Google Drive steps retry on their own. Anything that still fails is tried again on the next run (every step is safe to repeat).
- You get an email (through the **Error Handler**) when the sync has failed twice in a row, when it works again, and when there are new rows to fix. A one-off hiccup that fixes itself stays quiet, and you never get the same email every 5 minutes.

The latest result is always in the **sync_status** data table.`)}, [every5min, syncNow, syncSettings], { color: 5 });

export default workflow('inventory-sync', 'Inventory Sync (Google Drive Excel)', { settings: { executionOrder: 'v1', executionTimeout: 240, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'none' } })
  .add(every5min)
  .to(syncSettings)
  .add(syncNow)
  .to(syncSettings)
  .add(syncSettings)
  .to(loadLastStatus)
  .to(readCurrent)
  .to(findFile)
  .to(pickFile.onError(recordResult))
  .add(pickFile)
  .to(downloadFile.onError(recordResult))
  .add(downloadFile)
  .to(readRows)
  .to(validate.onError(recordResult))
  .add(validate)
  .to(safeToApply.onTrue(anyUpdates).onFalse(recordResult))
  .add(anyUpdates.onTrue(splitUpdates).onFalse(savesDone))
  .add(splitUpdates)
  .to(saveProduct)
  .to(savesDone)
  .to(anyRemovals.onTrue(splitRemovals).onFalse(removalsDone))
  .add(splitRemovals)
  .to(deleteProduct)
  .to(removalsDone)
  .to(recordResult)
  .to(saveStatus)
  .to(alertOwner.onTrue(alertPayload))
  .add(alertPayload)
  .to(sendAlert)
  .add(note);
`;
fs.writeFileSync(path.join(__dirname, 'sync.sdk.ts'), code);
console.log('sync.sdk.ts', code.length, 'chars');
