// Unit tests for the Store Assistant Code nodes, run outside n8n with a small emulation of $input / $().
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dir = path.join(__dirname, 'main');
const HW_BASE = fs.readFileSync(path.join(dir, 'hw_base.txt'), 'utf8').trim();
const load = f => fs.readFileSync(path.join(dir, f), 'utf8').replace('__HW_BASE__', HW_BASE);

// run a Code node: nodes = { 'Node Name': [json, ...] } of already-executed nodes
function run(file, input, nodes = {}, execId = '900') {
  const $input = { all: () => input.map(json => ({ json })), first: () => (input[0] === undefined ? undefined : { json: input[0] }) };
  const $ = name => {
    const items = nodes[name];
    return {
      isExecuted: items !== undefined,
      all: () => { if (!items) throw new Error(`node ${name} has not run`); return items.map(json => ({ json })); },
      first: () => { if (!items) throw new Error(`node ${name} has not run`); return items.length ? { json: items[0] } : undefined; },
    };
  };
  const out = new Function('$input', '$', '$execution', load(file))($input, $, { id: execId });
  return out.map(i => i.json);
}

const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'seed_rows.json'), 'utf8'))
  .map((r, i) => ({ ...r, id: i + 1, createdAt: 'x', updatedAt: 'y' }));
const settings = { store_name: 'IT Warehouse', store_contact: 'LINE @itwarehouse', store_hours: '10:00-20:00', store_policies: 'ติดต่อพนักงาน', vat_rate: 0.07 };
const webhook = body => ({ headers: {}, params: {}, query: {}, body, ...settings });

// ---------- Normalize Request
let n = run('normalize_request.js', [webhook({ session_id: 's1', message: '  มีเมาส์ไร้สายไหม ', mode: 'chat' })], { 'Store Settings': [settings] });
assert.deepStrictEqual([n[0].valid, n[0].message, n[0].lang, n[0].mode], [true, 'มีเมาส์ไร้สายไหม', 'th', 'chat']);
n = run('normalize_request.js', [webhook({ message: 'hi' })], { 'Store Settings': [settings] });
assert.strictEqual(n[0].valid, false); assert.match(n[0].errors[0], /session_id/);
n = run('normalize_request.js', [webhook({ session_id: 's1', mode: 'suggestion' })], { 'Store Settings': [settings] });
assert.strictEqual(n[0].valid, false);
n = run('normalize_request.js', [{ session_id: 's1', message: 'Is the MS-002 good for FPS?', ...settings }], { 'Store Settings': [settings] });
assert.deepStrictEqual([n[0].valid, n[0].lang], [true, 'en']);                         // fields at top level, English
n = run('normalize_request.js', [webhook({ session_id: 's1', mode: 'cart_total', cart: [{ sku: 'ms-002', qty: '2' }, { qty: 3 }, null] })], { 'Store Settings': [settings] });
assert.deepStrictEqual(n[0].cart, [{ sku: 'MS-002', qty: 2 }]);
n = run('normalize_request.js', [webhook({ session_id: 's1', message: 'x'.repeat(5000) })], { 'Store Settings': [settings] });
assert.strictEqual(n[0].message.length, 1000);
n = run('normalize_request.js', [webhook('not an object')], { 'Store Settings': [settings] });
assert.strictEqual(n[0].valid, false);
console.log('normalize_request OK');

// ---------- Build Context
const history = [
  { session_id: 's1', role: 'assistant', agent: 'hardware_expert', content: 'ขอทราบว่าจะใช้งานแบบไหนครับ', createdAt: '2' },
  { session_id: 's1', role: 'customer', agent: '', content: 'มีเมาส์ไหม', createdAt: '1' },
];
const ctxFor = (body, opts = {}) => {
  const req = run('normalize_request.js', [webhook(body)], { 'Store Settings': [settings] })[0];
  const nodes = {
    'Normalize Request': [req], 'Store Settings': [settings],
    'Load History': opts.history ?? history, 'Load Inventory': opts.inventory ?? inventory,
  };
  return { req, nodes, ctx: run('build_context.js', [{}], nodes)[0] };
};
let { ctx } = ctxFor({ session_id: 's1', message: 'แนะนำเมาส์ไร้สายสำหรับเล่นเกม FPS หน่อย' });
assert.strictEqual(ctx.route_hint, 'chat');
assert.strictEqual(ctx.history_text, 'Customer: มีเมาส์ไหม\nStore: ขอทราบว่าจะใช้งานแบบไหนครับ');
assert.strictEqual(ctx.last_assistant, 'ขอทราบว่าจะใช้งานแบบไหนครับ');
assert.ok(ctx.relevant.length > 0 && ctx.relevant.every(p => p.category === 'mouse'), 'relevant should be mice');
assert.deepStrictEqual(ctx.relevant.slice(0, 2).map(p => p.sku), ['MS-003', 'MS-001']); // same score: in-stock first
assert.strictEqual(ctx.catalog.find(p => p.sku === 'MS-002').price_inc_vat, 1487.3);
console.log('  relevant:', ctx.relevant.map(p => `${p.sku}(${p.stock_qty})`).join(' '));

({ ctx } = ctxFor({ session_id: 's1', mode: 'suggestion', context: { product_sku: 'MS-001' } }));
assert.deepStrictEqual([ctx.route_hint, ctx.suggestion_kind], ['suggestion_fixed', 'ask']);
({ ctx } = ctxFor({ session_id: 's1', mode: 'suggestion', message: 'เล่นเกม FPS จริงจัง', context: { product_sku: 'MS-001', stage: 'recommend' } }));
assert.strictEqual(ctx.route_hint, 'suggestion_ai');
assert.deepStrictEqual(ctx.candidates.map(p => p.sku), ['MS-006', 'MS-003', 'MS-004', 'MS-002', 'MS-005']);
assert.ok(!ctx.candidates.some(p => p.stock_qty === 0));
({ ctx } = ctxFor({ session_id: 's1', mode: 'suggestion', message: 'office', context: { product_sku: 'MS-002' } }));
assert.strictEqual(ctx.suggestion_kind, 'in_stock');
({ ctx } = ctxFor({ session_id: 's1', mode: 'suggestion', message: 'office', context: { product_sku: 'XX-999' } }));
assert.strictEqual(ctx.suggestion_kind, 'missing');
({ ctx } = ctxFor({ session_id: 's1', mode: 'suggestion', message: 'gaming', context: { product_sku: 'HS-001' } }, { inventory: inventory.filter(r => r.sku !== 'HS-002' && r.sku !== 'HS-003') }));
assert.strictEqual(ctx.suggestion_kind, 'none');
({ ctx } = ctxFor({ session_id: 's1', message: 'hi' }, { inventory: [{ error: 'data table down' }], history: [{ error: 'x' }] }));
assert.deepStrictEqual([ctx.inventory_ok, ctx.catalog.length, ctx.history_text, ctx.route_hint], [false, 0, '', 'chat']);
console.log('build_context OK');

// ---------- Prompts
({ ctx } = ctxFor({ session_id: 's1', message: 'แนะนำเมาส์ไร้สายสำหรับเล่นเกม FPS หน่อย' }));
for (const f of ['prompt_router.js', 'prompt_hardware.js', 'prompt_calculator.js', 'prompt_troubleshooter.js']) {
  const p = run(f, [ctx], { 'Build Context': [ctx] })[0];
  assert.ok(p.system.length > 200 && p.prompt.length > 10 && p.expect_json === true && p.required_keys.length === 1, f);
  assert.ok(!p.system.includes('__HW_BASE__') && !p.system.includes('${'), `${f} has unfilled placeholders`);
}
const hwPrompt = run('prompt_hardware.js', [ctx], { 'Build Context': [ctx] })[0];
assert.ok(hwPrompt.system.includes('IT Warehouse') && hwPrompt.system.includes('Thai'));
assert.ok(hwPrompt.prompt.includes('MS-001'));
({ ctx } = ctxFor({ session_id: 's1', mode: 'suggestion', message: 'เล่นเกม FPS', context: { product_sku: 'MS-001' } }));
const sp = run('prompt_suggestion.js', [ctx], { 'Build Context': [ctx] })[0];
assert.ok(sp.prompt.includes('OUT_OF_STOCK_PRODUCT') && sp.prompt.includes('MS-003') && !sp.system.includes('__HW_BASE__'));
console.log('prompts OK');

// ---------- Pick Route
({ ctx } = ctxFor({ session_id: 's1', message: 'เมาส์ที่ซื้อไปเสีย คลิกไม่ติด' }));
const pr = res => run('pick_route.js', [res], { 'Build Context': [ctx] })[0];
assert.deepStrictEqual(pr({ ok: true, tier: 1, data: { route: 'calculator' } }), { route: 'calculator', routed_by: 'ai', ai_tier: 1 });
assert.strictEqual(pr({ ok: true, tier: 1, data: { route: 'sales' } }).routed_by, 'keywords');
assert.strictEqual(pr({ ok: false }).route, 'troubleshooter');                  // "เสีย" (broken)
assert.strictEqual(pr({ error: 'engine crashed' }).route, 'troubleshooter');
({ ctx } = ctxFor({ session_id: 's1', message: 'MS-002 x2 กับ KB-003 1 ชิ้น รวม vat เท่าไหร่' }));
assert.strictEqual(run('pick_route.js', [{ ok: false }], { 'Build Context': [ctx] })[0].route, 'calculator');
({ ctx } = ctxFor({ session_id: 's1', message: 'แนะนำคีย์บอร์ดหน่อย' }));
assert.strictEqual(run('pick_route.js', [{ ok: false }], { 'Build Context': [ctx] })[0].route, 'hardware_expert');
console.log('pick_route OK');

// ---------- Finalize Hardware Expert
({ ctx } = ctxFor({ session_id: 's1', message: 'แนะนำเมาส์ไร้สายสำหรับเล่นเกม FPS หน่อย' }));
const fh = res => run('finalize_hardware.js', [res], { 'Build Context': [ctx] })[0];
let r = fh({ ok: true, tier: 1, data: { reply: 'แนะนำ Orbix Glide ครับ', product_skus: ['ms-003'], open_suggestion_sku: '' } });
assert.deepStrictEqual([r.degraded, r.products.map(p => p.sku), r.ai_tier], [false, ['MS-003'], 1]);
assert.ok(r.products[0].image_url.startsWith('https://'));
r = fh({ ok: true, tier: 1, data: { reply: 'MS-001 หมดครับ', product_skus: [], open_suggestion_sku: 'MS-001' } });
assert.deepStrictEqual([r.open_suggestion_sku, r.product_sku], ['MS-001', 'MS-001']);
r = fh({ ok: true, tier: 1, data: { reply: 'ลองรุ่น X', product_skus: ['FAKE-1'] } });
assert.strictEqual(r.degraded, true); assert.ok(r.products.every(p => p.stock_qty > 0));
r = fh({ ok: false, error: 'all failed' });
assert.strictEqual(r.degraded, true); assert.ok(r.products.length > 0 && r.products.length <= 3);
console.log('finalize_hardware OK');

// ---------- Suggestion (fixed + AI finalize)
({ ctx } = ctxFor({ session_id: 's1', mode: 'suggestion', context: { product_sku: 'MS-001' } }));
r = run('suggestion_fixed.js', [ctx], { 'Build Context': [ctx] })[0];
assert.ok(r.reply.includes('Veltra V1 Pro') && r.reply.includes('ใช้งานแบบไหน')); assert.strictEqual(r.next_stage, 'recommend');
({ ctx } = ctxFor({ session_id: 's1', mode: 'suggestion', message: 'office', context: { product_sku: 'MS-002' } }));
r = run('suggestion_fixed.js', [ctx], { 'Build Context': [ctx] })[0];
assert.strictEqual(r.products[0].sku, 'MS-002');
({ ctx } = ctxFor({ session_id: 's1', mode: 'suggestion', message: 'เล่นเกม FPS จริงจัง', context: { product_sku: 'MS-001' } }));
const fs2 = res => run('finalize_suggestion.js', [res], { 'Build Context': [ctx] })[0];
r = fs2({ ok: true, tier: 2, data: { reply: 'ขอแนะนำ Orbix Glide', recommended_skus: ['MS-003', 'MS-002'], follow_up_question: false } });
assert.deepStrictEqual([r.degraded, r.products.map(p => p.sku)], [false, ['MS-003', 'MS-002']]);
r = fs2({ ok: true, tier: 1, data: { reply: 'งบประมาณเท่าไหร่ครับ?', recommended_skus: [], follow_up_question: true } });
assert.deepStrictEqual([r.degraded, r.products.length], [false, 0]);
r = fs2({ ok: true, tier: 1, data: { reply: 'MS-001 ครับ', recommended_skus: ['MS-001'] } });  // sold-out item is not a candidate
assert.strictEqual(r.degraded, true);
r = fs2({ error: 'boom' });   // AI down: gaming mice first for a gamer, not just the closest price
assert.deepStrictEqual([r.degraded, r.products.map(p => p.sku)], [true, ['MS-003', 'MS-002', 'MS-004']]);
({ ctx } = ctxFor({ session_id: 's1', mode: 'suggestion', message: 'ใช้ทั่วไปครับ', context: { product_sku: 'MS-001' } }));
r = run('finalize_suggestion.js', [{ ok: false }], { 'Build Context': [ctx] })[0];
assert.deepStrictEqual(r.products.map(p => p.sku), ['MS-006', 'MS-003', 'MS-004']);  // no usage clue: closest price
console.log('suggestion OK');

// ---------- Compute Totals
({ ctx } = ctxFor({ session_id: 's1', mode: 'cart_total', cart: [{ sku: 'MS-002', qty: 2 }, { sku: 'KB-003', qty: 1 }, { sku: 'NOPE-1', qty: 1 }] }));
const ct = inp => run('compute_totals.js', [inp], { 'Build Context': [ctx] })[0];
r = ct(ctx);
assert.deepStrictEqual([r.totals.subtotal_ex_vat, r.totals.vat, r.totals.total_inc_vat], [3570, 249.9, 3819.9]);
assert.deepStrictEqual(r.totals.unmatched, ['NOPE-1']);
assert.ok(r.reply.includes('฿3,819.90') && r.reply.includes('VAT 7%'));
({ ctx } = ctxFor({ session_id: 's1', message: 'ms-002 x2 กับ HS-001 1 ตัว รวมเท่าไหร่' }));
r = ct({ ok: true, tier: 1, data: { items: [{ sku: 'MS-002', qty: 2 }, { sku: 'HS-001', qty: 1 }], unmatched: [] } });
assert.strictEqual(r.totals.total_inc_vat, 6708.9);  // (2780 + 3490) * 1.07
assert.ok(r.reply.includes('Auralis H7 Wireless Gaming Headset x1 = ฿3,490.00 (สินค้าหมด)'));  // HS-001 is sold out
r = ct({ ok: false });                                  // AI down: SKUs typed in the message still work
assert.deepStrictEqual([r.degraded, r.totals.lines.map(l => `${l.sku}x${l.qty}`)], [true, ['MS-002x2', 'HS-001x1']]);
({ ctx } = ctxFor({ session_id: 's1', message: 'รวมราคาให้หน่อย' }));
r = ct({ ok: false });
assert.strictEqual(r.totals, null); assert.ok(r.reply.includes('MS-002 x2'));
r = ct({ ok: true, tier: 1, data: { items: [{ sku: 'MS-006', qty: 9 }], unmatched: [] } });
assert.ok(r.reply.includes('(มีในสต็อกแค่ 6 ชิ้น)'));                               // not enough stock
({ ctx } = ctxFor({ session_id: 's1', message: 'เอา Veltra 2 ตัว' }, { history: [
  { session_id: 's1', role: 'assistant', agent: 'hardware_expert', content: 'แนะนำ Veltra V1 Wired Gaming Mouse ครับ', createdAt: '2' },
] }));
const cp = run('prompt_calculator.js', [ctx], { 'Build Context': [ctx] })[0];
assert.ok(cp.prompt.includes('MS-001 | Veltra V1 Pro Wireless Gaming Mouse | sold out'));
assert.ok(cp.prompt.includes('MS-002 | Veltra V1 Wired Gaming Mouse | in stock'));
assert.ok(cp.prompt.includes('Store: แนะนำ Veltra V1 Wired Gaming Mouse'));
({ ctx } = ctxFor({ session_id: 's1', mode: 'cart_total', cart: [{ sku: 'MS-002', qty: 1 }] }, { inventory: [{ error: 'table unavailable' }] }));
r = ct(ctx);                                            // price list down: say so, don't claim the item is missing
assert.ok(ctx.inventory_ok === false && r.degraded && r.totals === null && r.reply.includes('ระบบราคาสินค้าขัดข้อง'));
console.log('compute_totals OK');

// ---------- Troubleshooter
({ ctx } = ctxFor({ session_id: 's1', message: 'เมาส์เสีย' }));
r = run('finalize_troubleshooter.js', [{ ok: true, tier: 3, data: { reply: 'ลองเปลี่ยนพอร์ต USB ครับ', needs_human: false } }], { 'Build Context': [ctx] })[0];
assert.deepStrictEqual([r.degraded, r.needs_human, r.ai_tier], [false, false, 3]);
r = run('finalize_troubleshooter.js', [{ error: 'x' }], { 'Build Context': [ctx] })[0];
assert.deepStrictEqual([r.degraded, r.needs_human], [true, true]); assert.ok(r.reply.includes('LINE @itwarehouse'));
console.log('troubleshooter OK');

// ---------- Build Response / Emergency / Log rows
const { req } = ctxFor({ session_id: 's1', message: 'hello' });
r = run('build_response.js', [{ agent: 'calculator', reply: ' ok ', ai_tier: 2 }], { 'Normalize Request': [req], 'Pick Route': [{ routed_by: 'ai' }] })[0];
assert.deepStrictEqual([r.ok, r.reply, r.meta.routed_by, r.meta.ai_tier, r.session_id], [true, 'ok', 'ai', 2, 's1']);
r = run('build_response.js', [{}], {})[0];              // nothing upstream available: still a valid reply
assert.ok(r.ok && r.reply.length > 0);
r = run('emergency_reply.js', [{ error: 'boom' }], {})[0];
assert.ok(r.ok && r.degraded && r.reply.startsWith('ขออภัย'));
r = run('emergency_reply.js', [{ error: 'boom' }], { 'Normalize Request': [{ ...req, lang: 'en' }], 'Store Settings': [settings] })[0];
assert.ok(r.reply.startsWith('Sorry') && r.reply.includes('LINE @itwarehouse'));
let rows = run('prepare_log_rows.js', [{ agent: 'x', reply: 'hi' }], { 'Normalize Request': [req] });
assert.deepStrictEqual(rows.map(x => x.role), ['customer', 'assistant']);
rows = run('prepare_log_rows.js', [{ reply: 'hi' }], {});
assert.deepStrictEqual(rows, []);
r = run('build_response.js', [{ agent: 'hardware_expert', reply: 'ok' }], { 'Normalize Request': [req], 'Build Context': [{ inventory_ok: false }] })[0];
assert.strictEqual(r.degraded, true);                  // AI answered, but without product data
r = run('build_response.js', [{ agent: 'hardware_expert', reply: 'ok' }], { 'Normalize Request': [req], 'Build Context': [{ inventory_ok: true }] })[0];
assert.strictEqual(r.degraded, false);
console.log('build_response / emergency / log rows OK');

// ---------- Follow-up questions keep the products from the conversation
({ ctx } = ctxFor({ session_id: 's1', message: 'อันไหนเบากว่ากันครับ' }, { history: [
  { session_id: 's1', role: 'assistant', agent: 'hardware_expert', content: 'แนะนำ Auralis H5 Wired Gaming Headset กับ Auralis Office USB Headset ครับ', createdAt: '2' },
  { session_id: 's1', role: 'customer', agent: '', content: 'หูฟังเล่นเกมกับประชุม', createdAt: '1' },
] }));
assert.deepStrictEqual(ctx.relevant.map(p => p.sku).slice(0, 2), ['HS-002', 'HS-003']);
({ ctx } = ctxFor({ session_id: 's1', message: 'อันแรกกับอันที่สอง อันไหนแบตอึดกว่า' }, { history: [
  { session_id: 's1', role: 'assistant', agent: 'hardware_expert', content: 'แนะนำ Orbix Glide 4K Wireless Gaming Mouse, Kairo Pro Multi-Device Mouse และ Kairo Silent Wireless Mouse ครับ', createdAt: '2' },
] }));
assert.deepStrictEqual(ctx.relevant.map(p => p.sku).slice(0, 3), ['MS-003', 'MS-006', 'MS-005']);  // same order as the store listed them
({ ctx } = ctxFor({ session_id: 's1', message: 'แล้วคีย์บอร์ดล่ะ' }, { history: [
  { session_id: 's1', role: 'assistant', agent: 'hardware_expert', content: 'แนะนำ MS-002 ครับ', createdAt: '2' },
] }));
assert.ok(ctx.relevant.every(p => p.category === 'keyboard' || p.sku === 'MS-002'));  // the new topic first, the old product kept
assert.strictEqual(ctx.relevant[0].category, 'keyboard');
console.log('follow-up context OK');

// ---------- Node references must name output 0 explicitly.
// Without it n8n picks the output on the shortest path back, which can be an error output
// (Emergency Reply is wired to every error output) and then .first() returns nothing.
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
  const bad = fs.readFileSync(path.join(dir, f), 'utf8').match(/\$\('[^']+'\)\.(first|all|last)\(\)/g);
  assert.ok(!bad, `${f}: pass the output index, e.g. .first(0): ${bad}`);
}
console.log('node references OK');

console.log('\nALL MAIN TESTS PASSED');
