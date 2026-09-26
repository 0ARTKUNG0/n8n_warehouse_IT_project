// Unit tests for the Store AI Engine v2 Code nodes, run outside n8n with a small emulation of $input / $().
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dir = path.join(__dirname, 'engine2');
const load = f => fs.readFileSync(path.join(dir, f), 'utf8');

// nodes = { 'Node Name': { 0: [json...], 1: [json...] } } (output index -> items)
function run(src, input, nodes = {}) {
  const $input = { first: () => (input[0] === undefined ? undefined : { json: input[0] }), all: () => input.map(json => ({ json })) };
  const $ = name => {
    const outs = nodes[name];
    return {
      isExecuted: outs !== undefined,
      first: (b = 0) => { if (!outs) throw new Error(`${name} has not run`); const it = outs[b] ?? []; return it.length ? { json: it[0] } : undefined; },
      all: (b = 0) => { if (!outs) throw new Error(`${name} has not run`); return (outs[b] ?? []).map(json => ({ json })); },
    };
  };
  return new Function('$input', '$', src)($input, $).map(i => i.json);
}

// ---------- Normalize Input
let n = run(load('normalize_input.js'), [{ role: 'router', system: ' Route it ', prompt: ' hi ', expect_json: 'true', required_keys: ['route'] }])[0];
assert.deepStrictEqual([n.prompt, n.system, n.expect_json, n.max_tokens, n.messages.length], ['hi', 'Route it', true, 1024, 2]);
assert.ok(n.deadline - Date.now() > 9000 && n.deadline - Date.now() <= 10000);          // router: 10 s
assert.strictEqual(n.budget_ms, 10000);
n = run(load('normalize_input.js'), [{ role: 'hardware_expert', prompt: 'x' }])[0];
assert.ok(n.deadline - Date.now() > 27000 && n.deadline - Date.now() <= 28000);          // answers: 28 s
assert.strictEqual(n.system, 'You are a helpful assistant.');
n = run(load('normalize_input.js'), [{ role: 'x', prompt: 'x', budget_ms: 999999 }])[0];
assert.ok(n.deadline - Date.now() <= 55000);                                            // budget is capped
assert.throws(() => run(load('normalize_input.js'), [{ prompt: '  ' }]), /empty prompt/);
console.log('normalize_input OK');

// ---------- Check Model N
const check = load('check_answer.js').replace('__MODEL__', '"Test Model"').replace('__POSITION__', '3');
const cfg = (expect_json, required_keys = []) => ({ 'Normalize Input': { 0: [{ expect_json, required_keys }] } });
let r = run(check, [{ choices: [{ message: { content: '```json\n{"route": "calculator"}\n```' } }] }], cfg(true, ['route']))[0];
assert.deepStrictEqual([r.ok, r.tier, r.model, r.data.route], [true, 3, 'Test Model', 'calculator']);
r = run(check, [{ choices: [{ message: { content: '<think>hmm {"a":1}</think>{"route": "troubleshooter"}' } }] }], cfg(true, ['route']))[0];
assert.strictEqual(r.data.route, 'troubleshooter');                                   // reasoning text is ignored
r = run(check, [{ candidates: [{ content: { parts: [{ text: '{"reply": ' }, { text: '"ok"}' }] } }] }], cfg(true, ['reply']))[0];
assert.strictEqual(r.data.reply, 'ok');                                               // Gemini's own format
r = run(check, [{ choices: [{ message: { content: 'plain text answer' } }] }], cfg(false))[0];
assert.deepStrictEqual([r.text, r.data], ['plain text answer', null]);
assert.throws(() => run(check, [{ choices: [{ message: { content: '' }, finish_reason: 'length' }] }], cfg(true)), /empty answer \(length\)/);
assert.throws(() => run(check, [{ error: { message: 'Rate limit reached' } }], cfg(true)), /Rate limit reached/);
assert.throws(() => run(check, [{ choices: [{ message: { content: 'sure! here you go' } }] }], cfg(true)), /not JSON/);
assert.throws(() => run(check, [{ choices: [{ message: { content: '{"route": ' } }] }], cfg(true)), /not JSON|invalid JSON/);
assert.throws(() => run(check, [{ choices: [{ message: { content: '{"other": 1}' } }] }], cfg(true, ['route'])), /missing route/);
assert.throws(() => run(check, [{ choices: [{ message: { content: 'Answer:\nnot json' } }] }], cfg(true)),
              e => e.message === 'Test Model - answer is not JSON - Answer - not json');   // one line, no ":" for n8n to cut at
assert.throws(() => run(check, [{ choices: [{ message: { content: '[1, 2]' } }] }], cfg(true)), /not JSON|not an object/);
console.log('check_answer OK');

// ---------- All Models Failed
const failed = load('all_failed.js').replace('__STEPS__', JSON.stringify(['Model 1 A', 'Check Model 1', 'Model 2 B', 'Check Model 2']));
r = run(failed, [{ error: 'last error' }], {
  'Model 1 A': { 0: [], 1: [{ error: { message: '429 Rate limit reached' } }] },
  'Check Model 1': undefined,
  'Model 2 B': { 0: [{ choices: [] }], 1: [] },
  'Check Model 2': { 0: [], 1: [{ error: 'B: empty answer (length)' }] },
})[0];
assert.deepStrictEqual([r.ok, r.tier, r.data], [false, 0, null]);
assert.strictEqual(r.error, 'Model 1 A: 429 Rate limit reached | Check Model 2: B: empty answer (length)');
r = run(failed, [{ error: 'AI Engine received an empty prompt' }], {})[0];
assert.strictEqual(r.error, 'AI Engine received an empty prompt');                     // failed before any model ran
console.log('all_failed OK');

console.log('\nALL ENGINE TESTS PASSED');
