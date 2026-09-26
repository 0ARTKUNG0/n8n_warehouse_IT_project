// Runs Validate & Clean (sync/validate_and_clean.js) on real Excel files, the way the Inventory Sync does:
// Extract from File (xlsx, sheet "Inventory", include empty cells) -> Validate & Clean -> apply to the product list.
// Usage: node test_sync_excel.js [path/to/inventory.xlsx]   (default: the template in /inventory)
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const assert = require('assert');

const CODE = fs.readFileSync(path.join(__dirname, 'sync', 'validate_and_clean.js'), 'utf8');
const TEMPLATE = process.argv[2] || path.join(__dirname, '..', '..', 'inventory', 'inventory_template.xlsx');

// Extract from File → XLSX, Sheet Name "Inventory", Include Empty Cells ON (defval '')
function extract(file, { includeEmptyCells = true, sheet = 'Inventory' } = {}) {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  if (!wb.Sheets[sheet]) throw new Error(`sheet ${sheet} not found`);
  const opts = includeEmptyCells ? { defval: '' } : {};
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], opts);
  // "Always Output Data" on Extract from File: 0 rows → one empty item
  return rows.length ? rows.map(json => ({ json: JSON.parse(JSON.stringify(json)) })) : [{ json: {} }];
}

function run(excelItems, cacheRows, settings = { allow_big_changes: false }, rawCacheItems) {
  // "Always Output Data" on Read Current Products: empty table → one empty item
  const cacheItems = rawCacheItems ?? (cacheRows.length ? cacheRows.map(json => ({ json })) : [{ json: {} }]);
  const $input = { all: () => excelItems, first: () => excelItems[0] };
  const $ = name => {
    if (name === 'Sync Settings') return { all: () => [{ json: settings }], first: () => ({ json: settings }) };
    if (name !== 'Read Current Products') throw new Error(`unexpected node reference ${name}`);
    return { all: () => cacheItems, first: () => cacheItems[0] };
  };
  const out = new Function('$input', '$', CODE)($input, $);
  assert.strictEqual(out.length, 1);
  return out[0].json;
}

// the Data table after applying a sync result (what the Upsert + Delete nodes would do)
function apply(cacheRows, res) {
  const m = new Map(cacheRows.map(r => [r.sku, r]));
  res.upserts.forEach((p, i) => m.set(p.sku, { id: m.get(p.sku)?.id ?? 1000 + i, ...p, createdAt: 'x', updatedAt: 'y' }));
  res.removed.forEach(({ sku }) => m.delete(sku));
  return [...m.values()];
}

const log = (title, res) => {
  console.log(`\n=== ${title}`);
  console.log(JSON.stringify({ safe: res.safe, reason: res.reason, upserts: res.upserts.map(u => u.sku),
    removed: res.removed.map(r => r.sku), problems: res.problems }, null, 1));
};

// 1. first sync of the template into an empty Data table
const items = extract(TEMPLATE);
console.log('parsed rows:', items.length, 'keys:', Object.keys(items[0].json).join(','));
console.log('sample row:', JSON.stringify(items[1].json));
let res = run(items, []);
log('1. first sync, empty cache', res);
assert.strictEqual(res.safe, true);
assert.strictEqual(res.upserts.length, 14);
assert.strictEqual(res.problems.length, 0);
assert.strictEqual(res.upserts.filter(u => u.stock_qty === 0).length, 4);
let cache = apply([], res);

// 2. same file again → nothing to write
res = run(items, cache);
log('2. unchanged file', res);
assert.strictEqual(res.safe, true);
assert.strictEqual(res.upserts.length, 0);
assert.strictEqual(res.removed.length, 0);

// 3. staff edits with mistakes (as JS rows, same shape as Extract from File output)
const edited = items.map(i => ({ json: { ...i.json } }));
const bySku = s => edited.find(i => i.json.sku === s).json;
bySku('MS-002').stock_qty = 20;                  // normal stock change
bySku('KB-003').price_ex_vat = 'abc';            // typo → keep last good version
bySku('MS-004').stock_qty = '10 ชิ้น';            // text in a number cell → keep last good version
bySku('MS-005').price_ex_vat = '฿1,590.00';      // formatted text price → accepted as 1590
edited.splice(edited.findIndex(i => i.json.sku === 'HS-003'), 1); // row deleted → product removed
edited.push({ json: { ...bySku('HS-002'), name: 'dup row' } });   // duplicate sku
edited.push({ json: { sku: '', name: '', category: '', price_ex_vat: '', stock_qty: '', image_url: '', description: '', tags: '' } }); // blank line
edited.push({ json: { sku: 'gp-001', name: 'Gamepad X', category: 'Gamepad ', price_ex_vat: 990, stock_qty: 5,
                      image_url: 'www.example.com/gp.jpg', description: 'จอยเกม', tags: 'Gaming' } }); // new row, 2 warnings
edited.push({ json: { sku: 'MS-099', name: 'No price mouse', category: 'mouse', price_ex_vat: '', stock_qty: 3,
                      image_url: '', description: '', tags: '' } }); // new row with error → not added
res = run(edited, cache);
log('3. edits with mistakes', res);
assert.strictEqual(res.safe, true);
assert.deepStrictEqual(res.upserts.map(u => u.sku).sort(), ['GP-001', 'MS-002', 'MS-005']);
assert.strictEqual(res.upserts.find(u => u.sku === 'MS-005').price_ex_vat, 1590);
assert.strictEqual(res.upserts.find(u => u.sku === 'GP-001').image_url, '');
assert.strictEqual(res.upserts.find(u => u.sku === 'GP-001').category, 'gamepad');
assert.deepStrictEqual(res.removed.map(r => r.sku), ['HS-003']);
const issue = s => res.problems.filter(p => p.product.startsWith(s)).map(p => `${p.issue} -> ${p.action}`);
assert.match(issue('KB-003')[0], /price_ex_vat "abc".*kept the last good version/);
assert.match(issue('MS-004')[0], /stock_qty "10 ชิ้น".*kept the last good version/);
assert.match(issue('HS-002')[0], /duplicate sku/);
assert.strictEqual(issue('GP-001').length, 2);
assert.match(issue('MS-099')[0], /price_ex_vat "".*not added/);
cache = apply(cache, res);
assert.strictEqual(cache.find(r => r.sku === 'KB-003').price_ex_vat, 790); // last good price survives

// 4. wrong file saved (only 3 products) → blocked, cache untouched
res = run(items.slice(0, 3), cache);
log('4. wrong/short file', res);
assert.strictEqual(res.safe, false);
assert.match(res.reason, /only 3 valid products, but the store has 14/);
res = run(items.slice(0, 3), cache, { allow_big_changes: true });   // owner confirms it once
assert.strictEqual(res.safe, true);
assert.strictEqual(res.removed.length, 11);

// 4b. the sample products are replaced by a real catalog with other SKUs → allowed
const catalog = Array.from({ length: 6 }, (_, i) => ({ json: { sku: `RL-${i + 1}`, name: `Real ${i + 1}`, category: 'mouse',
  price_ex_vat: 500 + i, stock_qty: i, image_url: '', description: '', tags: '' } }));
res = run(catalog, cache);
assert.strictEqual(res.safe, true);                                    // 6 of 14 is more than 30%
assert.strictEqual(res.upserts.length, 6);
assert.strictEqual(res.removed.length, 14);
console.log('=== 4b. sample products replaced by a real catalog OK');

// 5. header renamed → throws (goes to the error output)
const renamed = items.map(i => { const { stock_qty, ...rest } = i.json; return { json: { ...rest, stock: stock_qty } }; });
assert.throws(() => run(renamed, cache), /missing column\(s\) stock_qty$/);
console.log('\n=== 5. renamed header → throws OK');

// 6. headers only (no products) → throws
assert.throws(() => run([{ json: {} }], cache), /has no rows/);
console.log('=== 6. empty sheet → throws OK');

// 7. header spelling variants are normalised
const variants = items.map(i => ({ json: Object.fromEntries(Object.entries(i.json).map(([k, v]) => [k === 'stock_qty' ? ' Stock Qty ' : k, v])) }));
res = run(variants, []);
assert.strictEqual(res.safe, true);
assert.strictEqual(res.upserts.length, 14);
console.log('=== 7. " Stock Qty " header accepted OK');

// 8. real file with a blank line inside the table + a bad price below it → the report names the product
const blankCopy = extract(path.join(__dirname, 'fixtures', 'blank_row_copy.xlsx'));
blankCopy.push({ json: { sku: '', name: '', category: 'mouse', price_ex_vat: 100, stock_qty: 1, image_url: '', description: '', tags: '' } });
res = run(blankCopy, apply([], run(items, [])));
log('8. blank line inside the table', res);
assert.deepStrictEqual(res.problems.map(p => p.product),
  ['MS-006 (Kairo Pro Multi-Device Mouse)', 'the row after HS-003']);
assert.strictEqual(res.problems[0].action, 'kept the last good version');

// 9. a failed read is passed on as an item ({ error }) by the step before: stop, change nothing
assert.throws(() => run(items, [], undefined, [{ json: { error: 'Data table not found' } }]),
              /Could not read the store's product list - Data table not found/);
assert.throws(() => run(items, [], undefined, [{ json: { id: 1, key: 'inventory', ok: true } }]),
              /Could not read the store's product list - unexpected data/);   // input passed through on an unexpected error
assert.throws(() => run([{ json: { error: 'Spreadsheet does not contain sheet called "Inventory"!' } }], cache),
              /Could not read the Excel file - Spreadsheet does not contain sheet called "Inventory"!/);
assert.throws(() => run(items, [], undefined, [{ json: { error: 'Request failed: timeout' } }]),
              /^Error: Could not read the store's product list - Request failed - timeout$/);   // no ":" left for n8n to cut at
res = run(items.map(i => ({ json: { ...i.json, error: '' } })), cache);    // a real "error" column is just a column
assert.strictEqual(res.safe, true);
console.log('=== 9. failed reads → throws OK');

console.log('\nALL TESTS PASSED');
