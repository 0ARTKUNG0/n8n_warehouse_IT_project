// Clean up the storefront request. Never throws: a bad request becomes { valid: false } and gets a 400 reply.
const settings = $('Store Settings').first(0).json;
const VAT_RATE = Number(settings.vat_rate) >= 0 ? Number(settings.vat_rate) : 0.07;
const txt = v => String(v ?? '').trim();

try {
  const raw = $input.first()?.json ?? {};
  const b = raw.body && typeof raw.body === 'object' ? raw.body : raw; // tests may send the fields at the top level
  const ctx = b.context && typeof b.context === 'object' ? b.context : {};

  const message = txt(b.message).slice(0, 1000);
  const mode = ['chat', 'suggestion', 'cart_total'].includes(txt(b.mode)) ? txt(b.mode) : 'chat';
  const session_id = txt(b.session_id).slice(0, 100);
  const product_sku = txt(ctx.product_sku ?? b.product_sku).toUpperCase().slice(0, 64);
  const stage = txt(ctx.stage ?? b.stage).slice(0, 32);
  const cart = (Array.isArray(b.cart) ? b.cart : [])
    .slice(0, 50)
    .map(l => ({ sku: txt(l?.sku).toUpperCase(), qty: Math.min(999, Math.max(1, parseInt(l?.qty, 10) || 1)) }))
    .filter(l => l.sku);
  const langHint = txt(b.lang).toLowerCase();
  const lang = ['th', 'en'].includes(langHint) ? langHint
    : (!message || /[\u0E00-\u0E7F]/.test(message)) ? 'th' : 'en';

  const errors = [];
  if (!session_id) errors.push('session_id is required');
  if (mode === 'chat' && !message) errors.push('message is required');
  if (mode === 'suggestion' && !product_sku) errors.push('context.product_sku is required in suggestion mode');
  if (mode === 'cart_total' && !cart.length) errors.push('cart is required in cart_total mode');

  return [{ json: {
    valid: errors.length === 0, errors,
    request_id: String($execution.id), session_id, mode, message, stage, product_sku, cart, lang,
    vat_rate: VAT_RATE,
  } }];
} catch (e) {
  return [{ json: {
    valid: false, errors: [`unreadable request: ${e.message}`],
    request_id: String($execution.id), session_id: '', mode: 'chat', message: '', stage: '', product_sku: '',
    cart: [], lang: 'th', vat_rate: VAT_RATE,
  } }];
}
