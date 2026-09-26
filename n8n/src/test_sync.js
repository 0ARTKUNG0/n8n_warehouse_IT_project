// Unit tests for the Inventory Sync Code nodes (the Excel row checks are in ../harness.js).
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const load = f => fs.readFileSync(path.join(__dirname, 'sync', f), 'utf8');

// nodes = { 'Node Name': { 0: [json...], 1: [json...] } }
function run(file, input, nodes = {}) {
  const $input = { first: () => (input[0] === undefined ? undefined : { json: input[0] }), all: () => input.map(json => ({ json })) };
  const $ = name => {
    const outs = nodes[name];
    return {
      isExecuted: outs !== undefined,
      first: (b = 0) => { if (!outs) throw new Error(`${name} has not run`); const it = outs[b] ?? []; return it.length ? { json: it[0] } : undefined; },
      all: (b = 0) => { if (!outs) throw new Error(`${name} has not run`); return (outs[b] ?? []).map(json => ({ json })); },
    };
  };
  return new Function('$input', '$', load(file))($input, $).map(i => i.json);
}
const settings = { 'Sync Settings': { 0: [{ file_name: 'inventory.xlsx', sheet_name: 'Inventory', allow_big_changes: false }] } };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEET = 'application/vnd.google-apps.spreadsheet';

// ---------- Pick Inventory File
let r = run('pick_file.js', [
  { id: 'a', name: 'inventory.xlsx', mimeType: XLSX, modifiedTime: '2026-09-01T00:00:00Z' },
  { id: 'b', name: 'inventory', mimeType: SHEET, modifiedTime: '2026-09-20T00:00:00Z' },
  { id: 'c', name: 'inventory backup.xlsx', mimeType: XLSX, modifiedTime: '2026-09-25T00:00:00Z' },   // other name
  { id: 'd', name: 'inventory.xlsx', mimeType: 'application/pdf', modifiedTime: '2026-09-26T00:00:00Z' }, // not a spreadsheet
  { id: 'e', name: 'Inventory.xlsx', mimeType: XLSX, modifiedTime: '2026-09-10T00:00:00Z', trashed: true },
], settings)[0];
assert.deepStrictEqual([r.id, r.other_copies], ['b', 1]);                   // newest matching file wins
assert.throws(() => run('pick_file.js', [{}], settings), /No Excel file "inventory.xlsx" or Google Sheet "inventory"/);
assert.throws(() => run('pick_file.js', [{ error: 'The user does not have sufficient permissions' }], settings),
              /^Error: Google Drive search failed - The user does not have sufficient permissions$/);   // passed on by Find Excel File
assert.throws(() => run('pick_file.js', [{ error: 'Request failed with status code 503: Service Unavailable.' }], settings),
              /^Error: Google Drive search failed - Request failed with status code 503 - Service Unavailable$/);  // no ":" left for n8n to cut at
console.log('pick_file OK');

// ---------- Saves Done / Removals Done
r = run('saves_done.js', [{}], { 'Save Product': { 0: [{ id: 1, sku: 'A' }, { error: { message: 'db locked' } }, { id: 2, sku: 'B' }] } })[0];
assert.deepStrictEqual([r.saved, r.save_failed, r.save_failures], [2, 1, ['db locked']]);
r = run('saves_done.js', [{ upserts: [] }], {})[0];                          // nothing to save
assert.deepStrictEqual([r.saved, r.save_failed], [0, 0]);
r = run('saves_done.js', [{}], { 'Save Product': { 0: [{}] } })[0];         // empty item from Always Output Data
assert.deepStrictEqual([r.saved, r.save_failed], [0, 0]);
r = run('removals_done.js', [{}], { 'Delete Product': { 0: [{ id: 5, sku: 'A' }, {}] }, 'Saves Done': { 0: [{ saved: 2, save_failed: 0, save_failures: [] }] } })[0];
assert.deepStrictEqual([r.saved, r.deleted, r.delete_failed], [2, 1, 0]);    // {} = product was already gone
r = run('removals_done.js', [{}], { 'Delete Product': { 0: [{ error: 'db down' }] }, 'Saves Done': { 0: [{ saved: 0, save_failed: 0 }] } })[0];
assert.deepStrictEqual([r.deleted, r.delete_failed, r.delete_failures], [0, 1, ['db down']]);
console.log('saves_done / removals_done OK');

// ---------- Split Removals never produces an empty SKU
r = run('split_removals.js', [], { 'Validate & Clean': { 0: [{ removed: [{ sku: 'A' }, { sku: '' }, { sku: '  ' }, {}, null] }] } });
assert.deepStrictEqual(r, [{ sku: 'A' }]);
console.log('split_removals OK');

// ---------- Record Result
const v = (extra = {}) => ({ safe: true, reason: '', products_in_file: 14, problems: [], problems_signature: '', ...extra });
const done = { saved: 1, deleted: 0, save_failed: 0, delete_failed: 0 };
const rec = (input, nodes) => run('record_result.js', [input], nodes)[0];
const status = st => ({ 'Load Last Status': { 0: [st] } });
const good = st => ({ 'Validate & Clean': { 0: [v()] }, ...status(st) });
const failAt = (node, st) => ({ [node]: { 0: [], 1: [{ error: 'x' }] }, ...status(st) });

r = rec(done, good({ key: 'inventory', ok: true, fails: 0, down_alerted: false, problems_signature: '' }));
assert.deepStrictEqual([r.ok, r.alert, r.fails, r.down_alerted], [true, false, 0, false]);   // normal run: no email
assert.match(r.message, /Synced 14 products: 1 added or updated, 0 removed\./);

// a one-off failure that fixes itself: no email at all
r = rec({ error: 'Google Drive search failed - 503. [line 11]' }, failAt('Pick Inventory File', { ok: true, fails: 0 }));
assert.deepStrictEqual([r.ok, r.alert, r.fails, r.down_alerted, r.alert_subject], [false, false, 1, false, '']);
assert.strictEqual(r.message, 'Inventory sync failed at "Pick Inventory File": Google Drive search failed - 503. The chat keeps using the last good product list.');
r = rec(done, good({ ok: false, fails: 1, down_alerted: false }));
assert.deepStrictEqual([r.ok, r.alert, r.fails], [true, false, 0]);

// fails twice in a row: one "stopped" email, then quiet while it stays down
r = rec({ error: 'Spreadsheet does not contain sheet called "Inventory"! [line 36]' }, failAt('Validate & Clean', { ok: false, fails: 1 }));
assert.match(r.message, /called "Inventory"! The chat keeps/);                // no "!." at the end of the error
r = rec({ error: 'Could not download' }, failAt('Download File', { ok: false, fails: 1, down_alerted: false }));
assert.deepStrictEqual([r.ok, r.alert, r.alert_subject, r.fails, r.down_alerted], [false, true, 'Inventory sync stopped', 2, true]);
assert.match(r.alert_detail, /failed at "Download File": Could not download/);
r = rec({ error: 'Could not download' }, failAt('Download File', { ok: false, fails: 2, down_alerted: true }));
assert.deepStrictEqual([r.alert, r.fails, r.down_alerted], [false, 3, true]);
// works again: one "works again" email
r = rec(done, good({ ok: false, fails: 3, down_alerted: true }));
assert.deepStrictEqual([r.ok, r.alert, r.alert_subject, r.fails, r.down_alerted], [true, true, 'Inventory sync works again', 0, false]);
// no status yet (first run ever) or the status row unreadable: counts from zero
r = rec({ error: 'x' }, failAt('Validate & Clean', {}));
assert.deepStrictEqual([r.alert, r.fails], [false, 1]);
r = rec({ error: 'x' }, failAt('Validate & Clean', { error: 'data table unavailable' }));
assert.deepStrictEqual([r.alert, r.fails], [false, 1]);

// spreadsheet problems: one email per new list, none for the same list
const prob = [{ product: 'MS-099 (No price mouse)', issue: 'price_ex_vat "" is not a valid price', action: 'not added' }];
const sig = 'MS-099 (No price mouse): price_ex_vat "" is not a valid price';
r = rec(done, { 'Validate & Clean': { 0: [v({ problems: prob, problems_signature: sig })] }, ...status({ ok: true, problems_signature: '' }) });
assert.deepStrictEqual([r.ok, r.alert, r.alert_subject, r.problems_signature], [true, true, 'Spreadsheet rows need fixing: MS-099 (No price mouse)', sig]);
assert.ok(r.alert_detail.includes('- MS-099 (No price mouse): price_ex_vat "" is not a valid price (not added)'));
r = rec(done, { 'Validate & Clean': { 0: [v({ problems: [...prob, ...prob], problems_signature: sig + '\nX' })] }, ...status({ ok: true, problems_signature: '' }) });
assert.strictEqual(r.alert_subject, 'Spreadsheet rows need fixing: MS-099 (No price mouse) and 1 more');
r = rec(done, { 'Validate & Clean': { 0: [v({ problems: prob, problems_signature: sig })] }, ...status({ ok: true, problems_signature: sig }) });
assert.strictEqual(r.alert, false);                                          // same problems as last time: no repeat email
// a failed run keeps the known problems, so the next good run doesn't email them again
r = rec({ error: 'x' }, failAt('Download File', { ok: true, fails: 0, problems_signature: sig }));
assert.strictEqual(r.problems_signature, sig);

// blocked by the safety check: nothing applied, counts as a failure, keeps the known problems
const blocked = v({ safe: false, reason: 'The file has only 3 valid products, but the store has 14.', problems: prob, problems_signature: 'other' });
r = rec(blocked, { 'Validate & Clean': { 0: [blocked] }, ...status({ ok: true, fails: 0, problems_signature: sig }) });
assert.deepStrictEqual([r.ok, r.alert, r.fails, r.problems_signature], [false, false, 1, sig]);
assert.match(r.message, /blocked, nothing was changed/);
r = rec(blocked, { 'Validate & Clean': { 0: [blocked] }, ...status({ ok: false, fails: 1, down_alerted: false }) });
assert.deepStrictEqual([r.alert, r.alert_subject], [true, 'Inventory sync stopped']);
assert.ok(r.alert_detail.includes('Rows to fix in the spreadsheet'));

// some saves failed: not ok (retried next run), emailed only if it keeps happening
r = rec({ ...done, save_failed: 2 }, good({ ok: true, fails: 0 }));
assert.deepStrictEqual([r.ok, r.alert, r.fails], [false, false, 1]);
assert.match(r.message, /2 change\(s\) could not be saved and will be retried/);
console.log('record_result OK');

r = run('alert_payload.js', [], { 'Record Result': { 0: [{ alert_subject: 'Inventory sync stopped', alert_detail: 'details' }] } })[0];
assert.deepStrictEqual(r, { workflow_name: 'Inventory Sync', message: 'Inventory sync stopped', detail: 'details', always_email: true });
console.log('alert_payload OK');

// ---------- node references name output 0 or 1 explicitly (see test_main.js for why)
for (const f of fs.readdirSync(path.join(__dirname, 'sync'))) {
  const bad = fs.readFileSync(path.join(__dirname, 'sync', f), 'utf8').match(/\$\('[^']+'\)\.(first|all|last)\(\)/g);
  assert.ok(!bad, `${f}: pass the output index: ${bad}`);
}
console.log('\nALL SYNC TESTS PASSED');
