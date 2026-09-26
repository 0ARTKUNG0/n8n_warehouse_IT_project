// Count what Delete Product did. A failed delete is simply tried again by the next sync.
let deleted = 0;
const failed = [];
if ($('Delete Product').isExecuted) {
  for (const i of $('Delete Product').all(0)) {
    if (i.json?.error) failed.push(String(i.json.error?.message ?? i.json.error));
    else if (i.json?.sku) deleted++;  // an empty item means the product was already gone
  }
}
const saves = $('Saves Done').first(0)?.json ?? { saved: 0, save_failed: 0, save_failures: [] };
return [{ json: { ...saves, deleted, delete_failures: failed.slice(0, 10), delete_failed: failed.length } }];
