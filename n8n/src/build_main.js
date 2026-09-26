// Generates the n8n Workflow SDK code for the Store Assistant main workflow.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'main');
const HW_BASE = fs.readFileSync(path.join(dir, 'hw_base.txt'), 'utf8').trim();
// Code node source as one short string literal per line ("a\n" + "b\n" ...) so the SDK file stays readable
const code = f => {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').replace('__HW_BASE__', HW_BASE).replace(/\n$/, '').split('\n');
  return lines.map(l => JSON.stringify(l + '\n')).join('\n      + ');
};
const js = s => JSON.stringify(s);

const ENGINE_ID = 'dTCYvEXogouuHzti';
const CHAT_LOG = { id: 'LqPu71kz7DuAU6Qc', name: 'chat_log' };
const INVENTORY = { id: 'xgTZJDsEG067UvCX', name: 'inventory' };
const table = t => `{ __rl: true, mode: 'list', value: '${t.id}', cachedResultName: '${t.name}' }`;

const RESULT = `{ ok: true, tier: 1, text: '{"reply": "..."}', data: { reply: 'ข้อความตอบลูกค้า' } }`;
const REPLY = `{ agent: 'hardware_expert', reply: 'ข้อความตอบลูกค้า', products: [], next_stage: '', degraded: false, ai_tier: 1 }`;
const FINAL = `{ ok: true, request_id: '1', session_id: 's1', agent: 'hardware_expert', reply: 'ข้อความตอบลูกค้า', products: [], totals: null, next_stage: '', product_sku: '', open_suggestion_sku: '', needs_human: false, degraded: false, meta: { routed_by: 'ai', ai_tier: 1 } }`;
const CTX = `{ valid: true, request_id: '1', session_id: 's1', mode: 'chat', message: 'แนะนำเมาส์เล่นเกม', lang: 'th', route_hint: 'chat', suggestion_kind: '', catalog: [], relevant: [], candidates: [] }`;

const codeNode = (v, name, file, x, y, output, extra = "onError: 'continueErrorOutput',") => `
const ${v} = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: '${name}',
    parameters: { mode: 'runOnceForAllItems', jsCode: ${code(file)} },
    ${extra}
    position: [${x}, ${y}]
  },
  output: [${output}]
});
`;

const engineCall = (v, name, x, y) => `
const ${v} = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: '${name}',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'list', value: '${ENGINE_ID}', cachedResultName: 'Store AI Engine (4-provider failover)' },
      options: { waitForSubWorkflow: true }
    },
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    onError: 'continueErrorOutput',
    position: [${x}, ${y}]
  },
  output: [${RESULT}]
});
`;

const rule = (key, field) => `{ outputKey: '${key}', renameOutput: true, conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.${field} }}'), rightValue: '${key}', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } }`;

const out = `import { workflow, node, trigger, sticky, ifElse, switchCase, expr } from '@n8n/workflow-sdk';

const storefrontWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Storefront Webhook',
    parameters: { httpMethod: 'POST', path: 'store-assistant', responseMode: 'responseNode', options: { allowedOrigins: '*' } },
    position: [0, 400]
  },
  output: [{ headers: {}, params: {}, query: {}, body: { session_id: 's1', mode: 'chat', message: 'แนะนำเมาส์เล่นเกม' } }]
});

const storeSettings = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Store Settings',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: 'store-name', name: 'store_name', value: 'IT Warehouse', type: 'string' },
          { id: 'store-contact', name: 'store_contact', value: ${js('หน้า "ติดต่อเรา" บนเว็บไซต์')}, type: 'string' },
          { id: 'store-hours', name: 'store_hours', value: ${js('ดูเวลาทำการได้ที่หน้าเว็บไซต์')}, type: 'string' },
          { id: 'store-policies', name: 'store_policies', value: ${js('เรื่องการรับประกัน การเปลี่ยนหรือคืนสินค้า ให้ลูกค้าติดต่อพนักงานเพื่อยืนยันเงื่อนไขทุกครั้ง')}, type: 'string' },
          { id: 'vat-rate', name: 'vat_rate', value: 0.07, type: 'number' }
        ]
      }
    },
    position: [220, 400]
  },
  output: [{ body: { session_id: 's1', message: 'แนะนำเมาส์เล่นเกม' }, store_name: 'IT Warehouse', store_contact: 'LINE', store_hours: '10-20', store_policies: '-', vat_rate: 0.07 }]
});
${codeNode('normalizeRequest', 'Normalize Request', 'normalize_request.js', 440, 400,
  `{ valid: true, errors: [], request_id: '1', session_id: 's1', mode: 'chat', message: 'แนะนำเมาส์เล่นเกม', stage: '', product_sku: '', cart: [], lang: 'th', vat_rate: 0.07 }`)}
const validRequest = ifElse({
  version: 2.3,
  config: {
    name: 'Valid Request?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.valid }}'), rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [660, 400]
  }
});

const respond400 = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond 400 Bad Request',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify({ ok: false, request_id: $json.request_id, errors: $json.errors }) }}'),
      options: { responseCode: 400 }
    },
    onError: 'continueRegularOutput',
    position: [880, 660]
  },
  output: [{ ok: false }]
});

const loadHistory = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load History',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: ${table(CHAT_LOG)},
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'session_id', condition: 'eq', keyValue: expr("{{ $('Normalize Request').first(0).json.session_id }}") }] },
      returnAll: false,
      limit: 8,
      orderBy: true,
      orderByColumn: 'createdAt',
      orderByDirection: 'DESC'
    },
    executeOnce: true,
    alwaysOutputData: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    onError: 'continueRegularOutput',
    position: [880, 400]
  },
  output: [{ session_id: 's1', role: 'customer', agent: '', content: 'สวัสดีครับ' }]
});

const loadInventory = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Inventory',
    parameters: { resource: 'row', operation: 'get', dataTableId: ${table(INVENTORY)}, returnAll: true },
    executeOnce: true,
    alwaysOutputData: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    onError: 'continueRegularOutput',
    position: [1100, 400]
  },
  output: [{ sku: 'MS-002', name: 'Veltra V1 Wired Gaming Mouse', category: 'mouse', price_ex_vat: 1390, stock_qty: 25, image_url: 'https://example.com/images/ms-002.jpg', description: 'เมาส์เกมมิ่งแบบมีสาย', tags: 'gaming,wired' }]
});
${codeNode('buildContext', 'Build Context', 'build_context.js', 1320, 400, CTX)}
const preRoute = switchCase({
  version: 3.4,
  config: {
    name: 'Pre-Route',
    parameters: {
      mode: 'rules',
      rules: { values: [${rule('suggestion_fixed', 'route_hint')}, ${rule('suggestion_ai', 'route_hint')}, ${rule('cart_total', 'route_hint')}] },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'chat' }
    },
    position: [1540, 400]
  }
});
${codeNode('suggestionFixed', 'Suggestion Reply (no AI)', 'suggestion_fixed.js', 1800, 0, REPLY)}
${codeNode('promptSuggestion', 'Prompt Suggestion', 'prompt_suggestion.js', 1800, 200, `{ role: 'hardware_expert_suggestion', system: '...', prompt: '...', expect_json: true, required_keys: ['reply'] }`)}
${engineCall('aiSuggestion', 'AI Engine Suggestion', 2020, 200)}
${codeNode('checkSuggestion', 'Check Suggestion Answer', 'finalize_suggestion.js', 2240, 200, REPLY)}
${codeNode('promptRouter', 'Prompt Router', 'prompt_router.js', 1800, 760, `{ role: 'router', system: '...', prompt: '...', expect_json: true, required_keys: ['route'] }`)}
${engineCall('aiRouter', 'AI Engine Router', 2020, 760)}
${codeNode('pickRoute', 'Pick Route', 'pick_route.js', 2240, 760, `{ route: 'hardware_expert', routed_by: 'ai', ai_tier: 1 }`)}
const routeToSpecialist = switchCase({
  version: 3.4,
  config: {
    name: 'Route to Specialist',
    parameters: {
      mode: 'rules',
      rules: { values: [${rule('hardware_expert', 'route')}, ${rule('calculator', 'route')}] },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'troubleshooter' }
    },
    position: [2460, 760]
  }
});
${codeNode('promptHardware', 'Prompt Hardware Expert', 'prompt_hardware.js', 2680, 500, `{ role: 'hardware_expert', system: '...', prompt: '...', expect_json: true, required_keys: ['reply'] }`)}
${engineCall('aiHardware', 'AI Engine Hardware Expert', 2900, 500)}
${codeNode('checkHardware', 'Check Hardware Answer', 'finalize_hardware.js', 3120, 500, REPLY)}
${codeNode('promptCalculator', 'Prompt Calculator', 'prompt_calculator.js', 2680, 760, `{ role: 'calculator', system: '...', prompt: '...', expect_json: true, required_keys: ['items'] }`)}
${engineCall('aiCalculator', 'AI Engine Calculator', 2900, 760)}
${codeNode('computeTotals', 'Compute Totals', 'compute_totals.js', 3120, 760, `{ agent: 'calculator', reply: 'สรุปราคาครับ', products: [], totals: { subtotal_ex_vat: 1390, vat: 97.3, vat_rate: 0.07, total_inc_vat: 1487.3, lines: [], unmatched: [] }, next_stage: '', degraded: false, ai_tier: 1 }`)}
${codeNode('promptTroubleshooter', 'Prompt Troubleshooter', 'prompt_troubleshooter.js', 2680, 1020, `{ role: 'troubleshooter', system: '...', prompt: '...', expect_json: true, required_keys: ['reply'] }`)}
${engineCall('aiTroubleshooter', 'AI Engine Troubleshooter', 2900, 1020)}
${codeNode('checkTroubleshooter', 'Check Troubleshooter Answer', 'finalize_troubleshooter.js', 3120, 1020, `{ agent: 'troubleshooter', reply: 'ลองเปลี่ยนพอร์ต USB ครับ', products: [], needs_human: false, next_stage: '', degraded: false, ai_tier: 1 }`)}
${codeNode('buildResponse', 'Build Response', 'build_response.js', 3400, 400, FINAL)}
${codeNode('emergencyReply', 'Emergency Reply', 'emergency_reply.js', 3400, 1300, FINAL, "onError: 'continueRegularOutput',")}
const respondStorefront = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond to Storefront',
    parameters: { respondWith: 'firstIncomingItem', options: { responseCode: 200 } },
    onError: 'continueRegularOutput',
    position: [3660, 400]
  },
  output: [${FINAL}]
});
${codeNode('prepareLog', 'Prepare Chat Log', 'prepare_log_rows.js', 3900, 400, `{ session_id: 's1', role: 'assistant', agent: 'hardware_expert', content: 'ข้อความตอบลูกค้า' }`, "onError: 'continueRegularOutput',")}
const saveChatLog = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save Chat Log',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: ${table(CHAT_LOG)},
      columns: {
        mappingMode: 'autoMapInputData',
        value: {},
        matchingColumns: [],
        schema: [
          { id: 'session_id', displayName: 'session_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'role', displayName: 'role', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'agent', displayName: 'agent', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'content', displayName: 'content', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    onError: 'continueRegularOutput',
    position: [4140, 400]
  },
  output: [{ id: 1, session_id: 's1', role: 'assistant' }]
});

const overviewNote = sticky(${js(`## Store Assistant: storefront chat API

**POST** \`/webhook/store-assistant\`
\`\`\`
{ "session_id": "abc", "mode": "chat | suggestion | cart_total",
  "message": "...", "lang": "th",
  "context": { "stage": "recommend", "product_sku": "MS-001" },
  "cart": [{ "sku": "MS-002", "qty": 2 }] }
\`\`\`
The reply always has the same shape: \`ok, agent, reply, products[], totals, next_stage, product_sku, open_suggestion_sku, needs_human, degraded\`.

**Suggestion chat:** send \`mode: "suggestion"\` with the sold-out \`product_sku\` and no message. The first reply asks what they'll use it for. Send their answer with \`stage: "recommend"\`.

Edit your store's contact, hours and policies in **Store Settings**.`)}, [storefrontWebhook, storeSettings, normalizeRequest], { color: 5 });

const durabilityNote = sticky(${js(`## How this workflow stays up

- **Every AI call** goes through **Store AI Engine**: 6 models on 4 providers, with retries and answer checks.
- **Every step that talks to something outside** (AI Engine, data tables) has a fallback: when it fails, the assistant still answers without it.
- **The AI engine fails completely?** Each specialist still answers without AI: the keyword router, closest-price picks, in-stock products that match the question, calculator math done in code, and basic troubleshooting steps.
- **Any logic step crashes?** Its error output goes to **Emergency Reply**, so the customer always gets an answer.
- **History or inventory unavailable?** The assistant keeps working without them.
- **Invented products are blocked:** if the AI returns an SKU that isn't in the product list, its answer is replaced.
- Prices and VAT are calculated in code, never by the AI.`)}, [buildResponse, emergencyReply], { color: 4 });

const settingsNote = sticky(${js(`### Edit me
Put your store name, contact (LINE / phone), opening hours, warranty and return policy, and VAT rate here. The AI only states what is written here.`)}, [storeSettings], { color: 3 });

export default workflow('store-assistant', 'Store Assistant (Storefront Chat API)', { settings: { executionOrder: 'v1', executionTimeout: 120, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all', saveManualExecutions: true } })
  .add(storefrontWebhook)
  .to(storeSettings)
  .to(normalizeRequest)
  .add(normalizeRequest.onError(emergencyReply))
  .add(normalizeRequest)
  .to(validRequest.onTrue(loadHistory).onFalse(respond400))
  .add(loadHistory)
  .to(loadInventory)
  .to(buildContext)
  .add(buildContext.onError(emergencyReply))
  .add(buildContext)
  .to(preRoute.onCase(0, suggestionFixed).onCase(1, promptSuggestion).onCase(2, computeTotals).onCase(3, promptRouter))
  .add(suggestionFixed.onError(emergencyReply))
  .add(suggestionFixed)
  .to(buildResponse)
  .add(promptSuggestion.onError(emergencyReply))
  .add(promptSuggestion)
  .to(aiSuggestion)
  .add(aiSuggestion.onError(checkSuggestion))
  .add(aiSuggestion)
  .to(checkSuggestion)
  .add(checkSuggestion.onError(emergencyReply))
  .add(checkSuggestion)
  .to(buildResponse)
  .add(promptRouter.onError(emergencyReply))
  .add(promptRouter)
  .to(aiRouter)
  .add(aiRouter.onError(pickRoute))
  .add(aiRouter)
  .to(pickRoute)
  .add(pickRoute.onError(emergencyReply))
  .add(pickRoute)
  .to(routeToSpecialist.onCase(0, promptHardware).onCase(1, promptCalculator).onCase(2, promptTroubleshooter))
  .add(promptHardware.onError(emergencyReply))
  .add(promptHardware)
  .to(aiHardware)
  .add(aiHardware.onError(checkHardware))
  .add(aiHardware)
  .to(checkHardware)
  .add(checkHardware.onError(emergencyReply))
  .add(checkHardware)
  .to(buildResponse)
  .add(promptCalculator.onError(emergencyReply))
  .add(promptCalculator)
  .to(aiCalculator)
  .add(aiCalculator.onError(computeTotals))
  .add(aiCalculator)
  .to(computeTotals)
  .add(computeTotals.onError(emergencyReply))
  .add(computeTotals)
  .to(buildResponse)
  .add(promptTroubleshooter.onError(emergencyReply))
  .add(promptTroubleshooter)
  .to(aiTroubleshooter)
  .add(aiTroubleshooter.onError(checkTroubleshooter))
  .add(aiTroubleshooter)
  .to(checkTroubleshooter)
  .add(checkTroubleshooter.onError(emergencyReply))
  .add(checkTroubleshooter)
  .to(buildResponse)
  .add(buildResponse.onError(emergencyReply))
  .add(buildResponse)
  .to(respondStorefront)
  .add(emergencyReply)
  .to(respondStorefront)
  .add(respondStorefront)
  .to(prepareLog)
  .to(saveChatLog)
  .add(overviewNote)
  .add(durabilityNote)
  .add(settingsNote);
`;

fs.writeFileSync(path.join(__dirname, 'main.sdk.ts'), out);
console.log('main.sdk.ts', out.length, 'chars');
