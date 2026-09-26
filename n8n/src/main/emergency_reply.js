// Last line of defence: every step that crashes sends its error here, and the customer still gets an answer.
// Everything is wrapped in try/catch so this node cannot fail itself.
let lang = 'th';
let request_id = String($execution.id);
let session_id = '';
let contact = '';
try {
  const r = $('Normalize Request').first(0).json;
  lang = r.lang || 'th';
  request_id = r.request_id || request_id;
  session_id = r.session_id || '';
} catch (e) {}
try {
  contact = String($('Store Settings').first(0).json.store_contact ?? '');
} catch (e) {}

const th = lang !== 'en';
const reply = th
  ? `ขออภัยครับ ระบบขัดข้องชั่วคราว รบกวนลองใหม่อีกครั้งในอีกสักครู่${contact ? ` หรือติดต่อพนักงานที่ ${contact}` : ''}`
  : `Sorry, something went wrong on our side. Please try again in a moment${contact ? ` or contact our staff: ${contact}` : ''}.`;

return [{ json: {
  ok: true, request_id, session_id, agent: 'system', reply, products: [], totals: null, next_stage: '',
  product_sku: '', open_suggestion_sku: '', needs_human: false, degraded: true,
  meta: { routed_by: 'emergency', ai_tier: 0 },
} }];
