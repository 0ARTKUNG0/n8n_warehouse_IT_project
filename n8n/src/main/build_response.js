// Put every answer into the same shape for the storefront.
let base = { request_id: String($execution.id), session_id: '', lang: 'th' };
try {
  const r = $('Normalize Request').first(0).json;
  base = { request_id: r.request_id, session_id: r.session_id, lang: r.lang };
} catch (e) {}

let routed_by = 'pre_route';
try {
  if ($('Pick Route').isExecuted) routed_by = $('Pick Route').first(0).json.routed_by;
} catch (e) {}

// product data could not be loaded: the answer is limited even if the AI replied
let inventoryDown = false;
try {
  if ($('Build Context').isExecuted) inventoryDown = $('Build Context').first(0).json.inventory_ok === false;
} catch (e) {}

const r = $input.first()?.json ?? {};
const th = base.lang !== 'en';
const reply = String(r.reply ?? '').trim()
  || (th ? 'ขออภัยครับ ระบบขัดข้องชั่วคราว รบกวนลองใหม่อีกครั้งครับ' : 'Sorry, something went wrong. Please try again.');

return [{ json: {
  ok: true,
  request_id: base.request_id,
  session_id: base.session_id,
  agent: String(r.agent ?? 'assistant'),
  reply,
  products: Array.isArray(r.products) ? r.products : [],
  totals: r.totals ?? null,
  next_stage: String(r.next_stage ?? ''),
  product_sku: String(r.product_sku ?? ''),
  open_suggestion_sku: String(r.open_suggestion_sku ?? ''),
  needs_human: r.needs_human === true,
  degraded: r.degraded === true || inventoryDown,
  meta: { routed_by, ai_tier: Number(r.ai_tier ?? 0) },
} }];
