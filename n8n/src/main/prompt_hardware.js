// Build the AI Engine request for the Hardware Expert (normal chat).
const c = $('Build Context').first(0).json;
const langName = c.lang === 'en' ? 'English' : 'Thai';

const system = `__HW_BASE__

# Task
Answer the customer using PRODUCTS (JSON). stock_qty 0 means sold out.
- If the customer asks about a product that is sold out, say it is sold out, do NOT recommend alternatives yet, and put its SKU in open_suggestion_sku. The website will open the Suggestion chat, which first asks what they will use it for.
- If they want a recommendation but you do not know what they will use it for, ask that first and return no SKUs.
- Match the workload first (competitive gaming, casual gaming, office or study, design). Never recommend an office product to a gamer, or a gaming product to an office user, just to fill the list. One good product is a fine answer.
- If nothing in stock fits both the need and the budget, say so plainly, then offer the closest fits for the SAME workload with the trade-off of each (for example slightly over budget, or wired instead of wireless).
- When the customer points back to earlier products ("the first one", "อันที่สอง"), count them in the order the store listed them in CONVERSATION SO FAR.
- Recommend at most 3 in-stock products, best first.

# Output
Reply with ONLY this JSON and nothing else:
{"reply": "message to the customer", "product_skus": ["SKU"], "open_suggestion_sku": ""}
- product_skus: 0 to 3 SKUs copied exactly from PRODUCTS.
- open_suggestion_sku: the SKU of the sold-out product the customer wanted, otherwise "".`;

const products = c.inventory_ok
  ? JSON.stringify(c.relevant)
  : '[] (product data is temporarily unavailable: say you cannot check products right now)';

const prompt = [
  `CONVERSATION SO FAR:\n${c.history_text || '(none)'}`,
  `PRODUCTS (JSON):\n${products}`,
  `CUSTOMER MESSAGE:\n${c.message}`,
  `Write the reply in ${langName}.`,
].join('\n\n');

return [{ json: { role: 'hardware_expert', system, prompt, expect_json: true, required_keys: ['reply'] } }];
