// Count what Save Product did (it reports a failed row as an item with an error instead of stopping).
// A failed row is simply tried again by the next sync.
let saved = 0;
const failed = [];
if ($('Save Product').isExecuted) {
  for (const i of $('Save Product').all(0)) {
    if (i.json?.error) failed.push(String(i.json.error?.message ?? i.json.error));
    else if (i.json?.sku) saved++;
  }
}
return [{ json: { saved, save_failures: failed.slice(0, 10), save_failed: failed.length } }];
