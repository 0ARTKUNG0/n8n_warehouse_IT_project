// Validate & Clean: checks every Excel row and works out what to change in the product list.
// In:  one item per Excel row (from Read Excel Rows) + the current products (from Read Current Products)
// Out: ONE item: { safe, reason, upserts[], removed[], problems[] }
const FIELDS = ['sku', 'name', 'category', 'price_ex_vat', 'stock_qty', 'image_url', 'description', 'tags'];
const REQUIRED = ['sku', 'name', 'category', 'price_ex_vat', 'stock_qty'];
const CATEGORIES = ['mouse', 'keyboard', 'headset', 'monitor', 'webcam', 'mousepad', 'speaker', 'accessory'];
// Refuse to sync when a file suddenly has far fewer valid products than the store has now
// (wrong file or sheet, rows deleted by mistake). Set allow_big_changes in Sync Settings to accept it once.
const MIN_KEEP_SHARE = 0.3;
const settings = $('Sync Settings').first(0)?.json ?? {};
const allowBigChanges = settings.allow_big_changes === true;

const key = k => String(k).trim().toLowerCase().replace(/[\s-]+/g, '_');
const txt = v => String(v ?? '').trim();
const num = v => (typeof v === 'number' ? v
  : txt(v) === '' ? NaN : Number(txt(v).replace(/บาท|thb|฿|,|\s/gi, '')));
const same = (a, b) => FIELDS.every(f => String(a[f] ?? '') === String(b[f] ?? ''));

// Read Current Products and Read Excel Rows pass a failure on as an item like { error: '...' }
const isError = j => j.error !== undefined && Object.keys(j).every(k => ['error', 'message', 'details'].includes(k));
const errText = e => (typeof e === 'string' ? e : e?.message ?? JSON.stringify(e)).slice(0, 300);
// n8n keeps only the first line of a Code node error, and only the text after its last ":",
// so the messages here are one line and use " - " instead
const plain = s => String(s).replace(/\s+/g, ' ').replace(/\s*:\s*/g, ' - ').replace(/[.\s]+$/, '');

// last good copy of every product (the Data table); a single empty item means the table is empty
const current = $('Read Current Products').all(0).map(i => i.json ?? {});
const readFail = current.find(isError);
if (readFail) throw new Error(`Could not read the store's product list - ${plain(errText(readFail.error))}`);
if (current.some(j => Object.keys(j).length && !('sku' in j))) throw new Error("Could not read the store's product list - unexpected data");
const cache = new Map(current.filter(j => j.sku).map(j => [j.sku, j]));

// Excel rows, header names normalised ("Stock Qty" -> "stock_qty")
const excel = $input.all().map(i => i.json ?? {});
const fileFail = excel.find(isError);
if (fileFail) throw new Error(`Could not read the Excel file - ${plain(errText(fileFail.error))}`);
const rows = excel.map(j => Object.fromEntries(Object.entries(j).map(([k, v]) => [key(k), v])));
if (!rows.some(r => Object.keys(r).length)) throw new Error('The Inventory sheet has no rows');
const headers = new Set(rows.flatMap(r => Object.keys(r)));
const missing = REQUIRED.filter(h => !headers.has(h));
if (missing.length) throw new Error(`The Inventory sheet is missing column(s) ${missing.join(', ')}`);

const upserts = [], problems = [], inFile = new Set();
let valid = 0, prevSku = '';
rows.forEach(r => {
  if (FIELDS.every(f => txt(r[f]) === '')) return; // empty line
  const sku = txt(r.sku).toUpperCase();            // SKUs are stored in upper case
  // blank lines are dropped before this node, so name the product instead of an Excel row number
  const product = sku ? `${sku} (${txt(r.name) || 'no name'})`
    : txt(r.name) ? `"${txt(r.name)}" (no sku)` : `the row after ${prevSku || 'the header'}`;
  if (sku) prevSku = sku;
  const p = {
    sku,
    name: txt(r.name),
    category: txt(r.category).toLowerCase(),
    price_ex_vat: Math.round(num(r.price_ex_vat) * 100) / 100,
    stock_qty: num(r.stock_qty),
    image_url: txt(r.image_url),
    description: txt(r.description).slice(0, 1000),
    tags: txt(r.tags).toLowerCase(),
  };

  if (sku && inFile.has(sku)) {
    problems.push({ product, issue: 'duplicate sku', action: 'ignored (the first row with this sku is used)' });
    return;
  }
  if (sku) inFile.add(sku); // present in the file → never removed, even if this row has mistakes

  const errors = [];
  if (!sku) errors.push('sku is empty');
  if (!p.name) errors.push('name is empty');
  if (!p.category) errors.push('category is empty');
  if (!Number.isFinite(p.price_ex_vat) || p.price_ex_vat < 0) errors.push(`price_ex_vat "${txt(r.price_ex_vat)}" is not a valid price`);
  if (!Number.isInteger(p.stock_qty) || p.stock_qty < 0) errors.push(`stock_qty "${txt(r.stock_qty)}" is not a whole number >= 0`);
  if (errors.length) {
    problems.push({ product, issue: errors.join('; '),
                    action: cache.has(sku) ? 'kept the last good version' : 'not added' });
    return;
  }

  // warnings: the row is still saved
  if (!CATEGORIES.includes(p.category)) problems.push({ product, issue: `unknown category "${p.category}"`, action: 'saved' });
  if (p.image_url && !/^https?:\/\//i.test(p.image_url)) {
    problems.push({ product, issue: 'image_url is not a link', action: 'saved without image' });
    p.image_url = '';
  }

  valid++;
  const old = cache.get(sku);
  if (!old || !same(old, p)) upserts.push(p); // only new or changed products are written
});

const removed = [...cache.keys()].filter(sku => !inFile.has(sku));
const shrinks = cache.size >= 10 && valid < cache.size * MIN_KEEP_SHARE;
const safe = valid > 0 && (!shrinks || allowBigChanges);
const reason = valid === 0 ? 'No valid products in the file'
  : !safe ? `The file has only ${valid} valid products, but the store has ${cache.size}. Wrong file or sheet? `
    + 'If this is right, set allow_big_changes to true in Sync Settings, run the sync once, then set it back to false.'
  : '';

return [{ json: {
  safe, reason,
  upserts,
  removed: removed.map(sku => ({ sku })),
  problems,
  problems_signature: problems.map(p => `${p.product}: ${p.issue}`).join('\n'),
  products_in_file: valid,
  products_before: cache.size,
} }];
