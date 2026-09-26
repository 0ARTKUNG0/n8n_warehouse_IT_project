// Generates the n8n Workflow SDK code for the Error Handler workflow.
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, 'errors', f), 'utf8');
const js = s => JSON.stringify(s);

const ERRORS_TABLE = `{ __rl: true, mode: 'list', value: '9biiFO4BtvslmOLg', cachedResultName: 'Error Handling' }`;
const col = id => `{ id: '${id}', displayName: '${id}', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }`;

const code = `import { workflow, node, trigger, sticky, ifElse, expr, placeholder } from '@n8n/workflow-sdk';

const errorTrigger = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: { name: 'When a Workflow Fails', position: [0, 300] },
  output: [{ execution: { id: '1', url: '', error: { message: 'Something failed' }, lastNodeExecuted: 'Node', mode: 'webhook' }, workflow: { id: '1', name: 'Store Assistant' } }]
});

const calledByWorkflow = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: { name: 'When Called by Another Workflow', parameters: { inputSource: 'passthrough' }, position: [0, 80] },
  output: [{ workflow_name: 'Inventory Sync', message: 'Inventory sync stopped', detail: 'Inventory sync failed at "Download File"', always_email: true }]
});

const testAlert = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Test Alert', position: [0, 520] },
  output: [{}]
});

const sampleError = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Sample Error', parameters: { mode: 'runOnceForAllItems', jsCode: ${js(read('sample_error.js'))} }, position: [240, 520] },
  output: [{ execution: { id: 'test', error: { message: 'Test alert' } }, workflow: { name: 'Error Handler (test)' } }]
});

const summarize = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Summarize Error',
    parameters: { mode: 'runOnceForAllItems', jsCode: ${js(read('summarize_error.js'))} },
    onError: 'continueRegularOutput',
    position: [480, 300]
  },
  output: [{ workflow_name: 'Store Assistant', message: 'Something failed', node: 'Node', execution_id: '1', execution_url: '', error_detail: 'Something failed' }]
});

const recentErrors = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Recent Errors of This Workflow',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: ${ERRORS_TABLE},
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'workflow_name', condition: 'eq', keyValue: expr('{{ $json.workflow_name }}') }] },
      returnAll: false,
      limit: 20,
      orderBy: true,
      orderByColumn: 'createdAt',
      orderByDirection: 'DESC'
    },
    alwaysOutputData: true,
    executeOnce: true,
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    onError: 'continueRegularOutput',
    position: [720, 300]
  },
  output: [{ workflow_name: 'Store Assistant', error_detail: 'Something failed', createdAt: '2026-01-01T00:00:00.000Z' }]
});

const decide = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Decide Email',
    parameters: { mode: 'runOnceForAllItems', jsCode: ${js(read('decide_email.js'))} },
    onError: 'continueRegularOutput',
    position: [960, 300]
  },
  output: [{ workflow_name: 'Store Assistant', message: 'Something failed', error_detail: 'Something failed', send_email: true, repeats_last_hour: 0 }]
});

const logError = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Log Error',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: ${ERRORS_TABLE},
      columns: {
        mappingMode: 'defineBelow',
        value: { workflow_name: expr('{{ $json.workflow_name }}'), error_detail: expr('{{ $json.error_detail }}') },
        matchingColumns: [],
        schema: [${col('workflow_name')}, ${col('error_detail')}]
      }
    },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    position: [1200, 300]
  },
  output: [{ workflow_name: 'Store Assistant', error_detail: 'Something failed' }]
});

const shouldEmail = ifElse({
  version: 2.3,
  config: {
    name: 'Email Now?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr("{{ $('Decide Email').first(0).json.send_email }}"), rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [1440, 300]
  }
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
      subject: expr("{{ '[Store alert] ' + $('Decide Email').first(0).json.workflow_name + ': ' + $('Decide Email').first(0).json.message.slice(0, 80) }}"),
      emailType: 'text',
      message: expr(${js(`{{ $('Decide Email').first(0).json.error_detail }}

The customer chat keeps working: failed steps fall back to safe answers.
Every error is saved in the Error Handling data table. The same error won't be emailed again for an hour.`)}),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: { id: 'oDZaXI1qofa3HUa3', name: 'Gmail account' } },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueRegularOutput',
    position: [1680, 220]
  },
  output: [{ id: 'msg', threadId: 'thread' }]
});

const note = sticky(${js(`## Error Handler

Runs automatically when **Store Assistant**, **Store AI Engine** or **Inventory Sync** fails in production. **Inventory Sync** also calls it directly to report sync problems (it decides itself when that is worth an email).

1. **Summarize Error** keeps what matters: workflow, error, node and a link to the failed execution.
2. **Log Error** saves it in the **Error Handling** data table.
3. **Email Alert** sends it to you, at most once an hour for the same workflow and error, so an outage can't flood your inbox.

**Set up once:** open **Email Alert** and enter the address that should receive alerts. Then click **Execute workflow** (Test Alert) to send a test email.`)}, [calledByWorkflow, errorTrigger, testAlert, sampleError, summarize], { color: 3 });

export default workflow('error-handler', 'Error Handler (alerts and log)', { settings: { executionOrder: 'v1', saveDataErrorExecution: 'all' } })
  .add(errorTrigger)
  .to(summarize)
  .add(calledByWorkflow)
  .to(summarize)
  .add(testAlert)
  .to(sampleError)
  .to(summarize)
  .add(summarize)
  .to(recentErrors)
  .to(decide)
  .to(logError)
  .to(shouldEmail.onTrue(emailAlert))
  .add(note);
`;
fs.writeFileSync(path.join(__dirname, 'errors.sdk.ts'), code);
console.log('errors.sdk.ts', code.length, 'chars');
