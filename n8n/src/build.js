// Builds the importable n8n workflow files in ../workflows from the sources in this folder.
// Each build_*.js writes n8n Workflow SDK code (*.sdk.ts, also usable with the n8n MCP server);
// this script turns that code into workflow JSON with stable node ids, so an unchanged workflow
// produces an unchanged file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseWorkflowCode } = require('@n8n/workflow-sdk');

// ids of the workflows in the store's n8n, so an import updates them instead of adding copies
const ERROR_HANDLER = 'TMxtguyRFd087DPT';
const WORKFLOWS = [
  { sdk: 'main.sdk.ts', out: 'store-assistant.json', id: 'u3XMAmDDWcnZs9JD', settings: { errorWorkflow: ERROR_HANDLER },
    webhookIds: { 'Storefront Webhook': '431102cf-bd6a-4fc7-8f7e-4e0a912ce370' } },
  { sdk: 'engine2.sdk.ts', out: 'store-ai-engine.json', id: 'zu2wYpcH5f6GIPMX', settings: { callerPolicy: 'workflowsFromSameOwner', errorWorkflow: ERROR_HANDLER } },
  { sdk: 'healthcheck.sdk.ts', out: 'ai-health-check.json', id: 'GnD28FtEE6ALcKNx', settings: {} },
  { sdk: 'errors.sdk.ts', out: 'error-handler.json', id: ERROR_HANDLER, settings: {} },
  { sdk: 'sync.sdk.ts', out: 'inventory-sync.json', id: 'x1h6TKuKb4p2eNc5', settings: { saveManualExecutions: true, errorWorkflow: ERROR_HANDLER } },
];

// same input -> same id (UUID format, derived from the workflow and node name)
const stableId = key => {
  const h = crypto.createHash('sha1').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

for (const builder of ['build_main.js', 'build_engine2.js', 'build_errors.js', 'build_sync.js']) {
  require(path.join(__dirname, builder));
}

const outDir = path.join(__dirname, '..', 'workflows');
fs.mkdirSync(outDir, { recursive: true });
for (const w of WORKFLOWS) {
  const code = fs.readFileSync(path.join(__dirname, w.sdk), 'utf8').replace(/^import .*;\s*$/gm, ''); // the parser rejects imports
  const wf = parseWorkflowCode(code);
  let sticky = 0;
  for (const node of wf.nodes) {
    if (node.type === 'n8n-nodes-base.stickyNote') {
      sticky += 1;
      node.name = sticky === 1 ? 'Sticky Note' : `Sticky Note ${sticky}`; // the SDK adds a random suffix
    }
    node.id = stableId(`${w.id}/${node.name}`);
    if (node.webhookId) node.webhookId = w.webhookIds?.[node.name] ?? stableId(`${w.id}/${node.name}/webhook`);
  }
  const out = { id: w.id, name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1', ...wf.settings, ...w.settings } };
  fs.writeFileSync(path.join(outDir, w.out), JSON.stringify(out, null, 2) + '\n');
  console.log(`workflows/${w.out}: ${out.nodes.length} nodes`);
}
