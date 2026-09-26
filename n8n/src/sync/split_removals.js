// One item per product that is no longer in the file, for Delete Product. Never an empty SKU.
return $('Validate & Clean').first(0).json.removed
  .filter(r => r && String(r.sku ?? '').trim())
  .map(r => ({ json: { sku: String(r.sku).trim() } }));
