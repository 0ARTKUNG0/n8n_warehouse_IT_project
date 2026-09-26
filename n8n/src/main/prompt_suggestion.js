// Build the AI Engine request for the Hardware Expert in Suggestion mode (the wanted product is sold out).
const c = $('Build Context').first(0).json;
const langName = c.lang === 'en' ? 'English' : 'Thai';

const system = `__HW_BASE__

# Task: Suggestion mode (the product the customer wanted is sold out)
You receive OUT_OF_STOCK_PRODUCT, CUSTOMER_USAGE, CONVERSATION and IN_STOCK_CANDIDATES (JSON).
1. Work out what matters for their workload:
   - Competitive or heavy gaming (FPS, MOBA): accurate sensor, 1000 Hz+ polling, light weight, wired or low-latency 2.4 GHz wireless; keyboards: fast switches, anti-ghosting / N-key rollover.
   - Casual gaming: good sensor, comfort, value. RGB is optional.
   - Office or study: comfort, quiet clicks or switches, wireless or Bluetooth, battery life, multi-device, value.
   - Design or video editing: precise tracking, programmable buttons or macro keys, ergonomics.
   - Travel or laptop: compact, Bluetooth, battery life.
   If CUSTOMER_USAGE is too vague to choose (for example "normal use"), ask ONE short follow-up question (budget, or wired vs wireless) and recommend nothing, unless CONVERSATION shows you already asked one.
2. Rank candidates by fit to the workload first, then by closeness to the original product (price_diff_pct). Do not push the most expensive item; a cheaper one that fits is a good answer.
3. Recommend 1 to 3 products, best first. For each: one sentence on why it fits THIS customer's usage, plus one honest trade-off compared with the sold-out product they wanted, if there is one. They have not bought or used it: in Thai call it "รุ่นที่คุณสนใจ", never "รุ่นที่คุณเคยใช้".
4. If nothing fits well, say so honestly and give the closest option.

# Output
Reply with ONLY this JSON and nothing else:
{"reply": "message to the customer", "recommended_skus": ["SKU"], "follow_up_question": false}
- recommended_skus: 0 to 3 SKUs copied exactly from IN_STOCK_CANDIDATES, best first.
- follow_up_question: true only if reply is a question and recommended_skus is empty.`;

const t = c.target;
const prompt = [
  `OUT_OF_STOCK_PRODUCT (JSON):\n${JSON.stringify({ sku: t.sku, name: t.name, category: t.category, price_inc_vat: t.price_inc_vat, tags: t.tags, description: t.description })}`,
  `CUSTOMER_USAGE:\n${c.message}`,
  `CONVERSATION SO FAR:\n${c.history_text || '(none)'}`,
  `IN_STOCK_CANDIDATES (JSON):\n${JSON.stringify(c.candidates)}`,
  `Write the reply in ${langName}.`,
].join('\n\n');

return [{ json: { role: 'hardware_expert_suggestion', system, prompt, expect_json: true, required_keys: ['reply'] } }];
