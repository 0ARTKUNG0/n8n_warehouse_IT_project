// Unit tests for the Error Handler Code nodes.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const load = f => fs.readFileSync(path.join(__dirname, 'errors', f), 'utf8');
function run(src, input, nodes = {}) {
  const $input = { first: () => (input[0] === undefined ? undefined : { json: input[0] }), all: () => input.map(json => ({ json })) };
  const $ = name => ({ first: () => ({ json: nodes[name][0] }) });
  return new Function('$input', '$', src)($input, $).map(i => i.json);
}

let s = run(load('summarize_error.js'), [{
  execution: { id: '42', url: 'https://n8n/x/42', error: { message: 'Groq 429' }, lastNodeExecuted: 'AI Engine Router', mode: 'webhook' },
  workflow: { name: 'Store Assistant' },
}])[0];
assert.deepStrictEqual([s.workflow_name, s.message, s.node, s.execution_id], ['Store Assistant', 'Groq 429', 'AI Engine Router', '42']);
assert.strictEqual(s.error_detail.split('\n')[0], 'Groq 429');
assert.ok(s.error_detail.includes('Open: https://n8n/x/42'));
s = run(load('summarize_error.js'), [{ trigger: { error: { message: 'Schedule trigger failed' } }, workflow: { name: 'Inventory Sync' } }])[0];
assert.deepStrictEqual([s.workflow_name, s.message], ['Inventory Sync', 'Schedule trigger failed']);
s = run(load('summarize_error.js'), [{}])[0];
assert.deepStrictEqual([s.workflow_name, s.message], ['Unknown workflow', 'Unknown error']);
s = run(load('summarize_error.js'), run(load('sample_error.js'), []))[0];
assert.ok(s.message.startsWith('Test alert'));
s = run(load('summarize_error.js'), [{ workflow_name: 'Inventory Sync', message: 'Spreadsheet rows need fixing', detail: 'Synced 14 products.\n- MS-099: no price' }])[0];
assert.deepStrictEqual([s.workflow_name, s.message], ['Inventory Sync', 'Spreadsheet rows need fixing']);
assert.strictEqual(s.error_detail, 'Spreadsheet rows need fixing\nSynced 14 products.\n- MS-099: no price');
assert.strictEqual(s.always_email, false);
s = run(load('summarize_error.js'), [{ workflow_name: 'Inventory Sync', message: 'Inventory sync stopped', detail: 'x', always_email: true }])[0];
assert.strictEqual(s.always_email, true);
console.log('summarize_error OK');

const cur = { workflow_name: 'Store Assistant', message: 'Groq 429', error_detail: 'Groq 429\nNode: X' };
const now = new Date().toISOString(), old = new Date(Date.now() - 2 * 3600e3).toISOString();
let d = run(load('decide_email.js'), [{ error_detail: 'Groq 429\nNode: Y', createdAt: now }], { 'Summarize Error': [cur] })[0];
assert.deepStrictEqual([d.send_email, d.repeats_last_hour], [false, 1]);          // same error this hour: log only
d = run(load('decide_email.js'), [{ error_detail: 'Groq 429\nNode: Y', createdAt: old }], { 'Summarize Error': [cur] })[0];
assert.strictEqual(d.send_email, true);                                          // last one was 2 hours ago
d = run(load('decide_email.js'), [{ error_detail: 'Other error', createdAt: now }], { 'Summarize Error': [cur] })[0];
assert.strictEqual(d.send_email, true);                                          // different error
d = run(load('decide_email.js'), [{}], { 'Summarize Error': [cur] })[0];         // table empty or unreadable
assert.strictEqual(d.send_email, true);
const syncAlert = { workflow_name: 'Inventory Sync', message: 'Inventory sync stopped', error_detail: 'Inventory sync stopped\nx', always_email: true };
d = run(load('decide_email.js'), [{ error_detail: 'Inventory sync stopped\ny', createdAt: now }], { 'Summarize Error': [syncAlert] })[0];
assert.strictEqual(d.send_email, true);                                          // stopped again after "works again": still emailed
console.log('decide_email OK');
console.log('\nALL ERROR HANDLER TESTS PASSED');
