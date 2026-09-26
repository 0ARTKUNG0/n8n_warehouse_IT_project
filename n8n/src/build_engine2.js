// Generates n8n Workflow SDK code for:
//   engine2.sdk.ts      Store AI Engine v2: every AI call, 6 models on 4 providers, hard timeouts, one deadline
//   healthcheck.sdk.ts  AI Health Check: sends one test prompt to each of the 6 models and reports which work
// Both come from the MODELS list below, so a model ID only has to be changed in one place.
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, 'engine2', f), 'utf8');
const js = s => JSON.stringify(s);

const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    credType: 'groqApi', cred: { id: 'fk0N9mxbYr8EqEaP', name: 'Groq account' },
  },
  // Gemini's own API: its OpenAI-style endpoint needs a Bearer header, but the n8n Gemini credential sends ?key=
  gemini: {
    url: m => `https://generativelanguage.googleapis.com/v1beta/models/${m.model}:generateContent`,
    credType: 'googlePalmApi', cred: { id: 'iEXJevGkgXLcbG0R', name: 'Google Gemini(PaLM) Api account' },
    native: true,
  },
  typhoon: {
    url: 'https://api.opentyphoon.ai/v1/chat/completions',
    credType: 'openAiApi', cred: { id: 'PE4a99E59SbOLdME', name: 'Typhoon OpenAI' },
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    credType: 'openRouterApi', cred: { id: 'pcGqe59RslOnjuKk', name: 'OpenRouter account' },
  },
};

// Tried in this order. cap = the most time (ms) one model may take before the next one is tried.
// Fastest first (Groq and Typhoon answer in well under a second); Gemini is strong but its speed varies
// (1 to 10 s); OpenRouter's free pool is often rate limited, so it is the last resort.
// Groq rate limits are per model, so Qwen usually still works when GPT-OSS is rate limited.
const MODELS = [
  { label: 'Groq GPT-OSS 120B', provider: 'groq', model: 'openai/gpt-oss-120b', cap: 10000, extraExpr: { reasoning_effort: 'reasoning_effort' } },
  { label: 'Groq Qwen 3.8 27B', provider: 'groq', model: 'qwen/qwen3.8-27b', cap: 10000 },
  { label: 'Typhoon 2.5 Thai', provider: 'typhoon', model: 'typhoon-v2.5-30b-a3b-instruct', cap: 10000 },
  { label: 'Gemini Flash-Lite', provider: 'gemini', model: 'gemini-flash-lite-latest', cap: 10000 },
  { label: 'Gemini Flash', provider: 'gemini', model: 'gemini-flash-latest', cap: 15000 },
  { label: 'OpenRouter Gemma 4 31B', provider: 'openrouter', model: 'google/gemma-4-31b-it:free', cap: 15000 },
];
const modelName = i => `Model ${i + 1} ${MODELS[i].label}`;
const IN = "$('Normalize Input').first(0).json";
const checkName = i => `Check Model ${i + 1}`;

// Request body as readable JSON with n8n expressions, so the model ID is easy to change in the editor.
const body = m => {
  if (PROVIDERS[m.provider].native) {
    return `{
  "systemInstruction": { "parts": [{ "text": {{ JSON.stringify(${IN}.system) }} }] },
  "contents": [{ "role": "user", "parts": [{ "text": {{ JSON.stringify(${IN}.prompt) }} }] }],
  "generationConfig": { "temperature": 0.2, "maxOutputTokens": {{ Math.max(4096, ${IN}.max_tokens) }}, "thinkingConfig": { "thinkingLevel": "low" } }
}`;
  }
  const lines = [
    `  "model": ${js(m.model)}`,
    `  "messages": {{ JSON.stringify($('Normalize Input').first(0).json.messages) }}`,
    `  "temperature": 0.2`,
    `  "max_tokens": {{ $('Normalize Input').first(0).json.max_tokens }}`,
    ...Object.entries(m.extra ?? {}).map(([k, v]) => `  ${js(k)}: ${js(v)}`),
    ...Object.entries(m.extraExpr ?? {}).map(([k, f]) => `  ${js(k)}: {{ JSON.stringify(${IN}.${f} ?? ${js(f === 'reasoning_effort' ? 'medium' : null)}) }}`),
  ];
  return `{\n${lines.join(',\n')}\n}`;
};
// Engine: a model may use at most its cap and at most half of the time left before the shared deadline,
// so a stuck model always leaves time for the next ones (a healthy model answers in 0.1 to 5 s).
// The last model may use all of the time left.
const engineTimeout = (m, last) =>
  `{{ Math.max(1, Math.min(${m.cap}, (${IN}.deadline - Date.now())${last ? '' : ' / 2'})) }}`;

const httpNode = (v, i, x, y, timeout, extra) => {
  const m = MODELS[i];
  const p = PROVIDERS[m.provider];
  return `
const ${v} = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: ${js(modelName(i))},
    parameters: {
      method: 'POST',
      url: ${js(typeof p.url === 'function' ? p.url(m) : p.url)},
      authentication: 'predefinedCredentialType',
      nodeCredentialType: ${js(p.credType)},
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(${js(body(m))}),
      options: { timeout: ${timeout} }
    },
    credentials: { ${p.credType}: { id: ${js(p.cred.id)}, name: ${js(p.cred.name)} } },
    ${extra}
    position: [${x}, ${y}]
  },
  output: [{ choices: [{ message: { content: '{"route": "hardware_expert"}' }, finish_reason: 'stop' }] }]
});
`;
};

const SAMPLE = `// Change this sample to try the engine by hand (Execute workflow).
return [{ json: {
  role: 'router',
  system: "You are the request router for an online computer-hardware store. Reply with ONLY this JSON: {\\"route\\": \\"hardware_expert\\" | \\"calculator\\" | \\"troubleshooter\\"}",
  prompt: "Customer message: มีเมาส์ไร้สายสำหรับเล่นเกม FPS แนะนำไหมครับ",
  expect_json: true,
  required_keys: ['route'],
} }];
`;

// ---------------------------------------------------------------- Store AI Engine v2
const X0 = 760, DX = 440;
const steps = MODELS.flatMap((_, i) => [modelName(i), checkName(i)]);
let engine = `import { workflow, node, trigger, sticky, ifElse, expr } from '@n8n/workflow-sdk';

const calledByStore = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: { name: 'When Called by Store Assistant', parameters: { inputSource: 'passthrough' }, position: [0, 300] },
  output: [{ role: 'router', system: 'Reply with ONLY this JSON: {"route": "..."}', prompt: 'Customer message: สวัสดีครับ', expect_json: true, required_keys: ['route'] }]
});

const manualTest = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Test Engine', position: [0, 520] },
  output: [{}]
});

const sampleRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Sample Request', parameters: { mode: 'runOnceForAllItems', jsCode: ${js(SAMPLE)} }, position: [240, 520] },
  output: [{ role: 'router', system: 'Reply with ONLY this JSON: {"route": "..."}', prompt: 'Customer message: สวัสดีครับ', expect_json: true, required_keys: ['route'] }]
});

const normalizeInput = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Input',
    parameters: { mode: 'runOnceForAllItems', jsCode: ${js(read('normalize_input.js'))} },
    onError: 'continueErrorOutput',
    position: [480, 300]
  },
  output: [{ role: 'router', system: '...', prompt: '...', expect_json: true, required_keys: ['route'], messages: [], max_tokens: 1024, deadline: 0 }]
});
`;
MODELS.forEach((m, i) => {
  engine += httpNode(`model${i + 1}`, i, X0 + DX * i, 300, `expr(${js(engineTimeout(m, i === MODELS.length - 1))})`, "onError: 'continueErrorOutput',");
  engine += `
const check${i + 1} = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: ${js(checkName(i))},
    parameters: { mode: 'runOnceForAllItems', jsCode: ${js(read('check_answer.js').replace('__MODEL__', js(m.label)).replace('__POSITION__', String(i + 1)))} },
    onError: 'continueErrorOutput',
    position: [${X0 + DX * i + 220}, 100]
  },
  output: [{ ok: true, tier: ${i + 1}, model: ${js(m.label)}, text: '{"route": "hardware_expert"}', data: { route: 'hardware_expert' } }]
});
`;
});
const XE = X0 + DX * MODELS.length;
engine += `
const timeLeft = ifElse({
  version: 2.3,
  config: {
    name: 'Time Left for Another Round?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr("{{ $runIndex === 0 && Date.now() < $('Normalize Input').first(0).json.deadline - 5000 }}"), rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [${XE}, 480]
  }
});

const waitBeforeRetry = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: { name: 'Wait 1 Second', parameters: { resume: 'timeInterval', amount: 1, unit: 'seconds' }, position: [${XE + 220}, 640] },
  output: [{}]
});

const allFailed = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'All Models Failed',
    parameters: { mode: 'runOnceForAllItems', jsCode: ${js(read('all_failed.js').replace('__STEPS__', js(steps)))} },
    onError: 'continueRegularOutput',
    position: [${XE + 220}, 400]
  },
  output: [{ ok: false, tier: 0, model: '', text: '', data: null, error: 'All AI providers failed' }]
});

const returnResult = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Return Result', position: [${XE + 440}, 100] },
  output: [{ ok: true, tier: 1, model: 'Groq GPT-OSS 120B', text: '{"route": "hardware_expert"}', data: { route: 'hardware_expert' } }]
});

const guide = sticky(${js(`## Store AI Engine: every AI call goes through here

The Store Assistant sends \`{ role, system, prompt, expect_json, required_keys }\` and always gets back \`{ ok, tier, model, text, data }\`.

**6 models on 4 providers, tried in order:**
${MODELS.map((m, i) => `${i + 1}. ${m.label}`).join('\n')}

**How it stays fast when a provider has problems:**
- Each model gets a hard time limit: at most 10 to 15 s, and at most half of the time left before the request's deadline (10 s for routing, 28 s for answers). A stuck model can never use up the time the others need.
- A rate limit (429), server error, time-out or unusable answer (not JSON, missing fields) hands over to the next model at once. Waiting on a rate-limited or stuck provider rarely helps.
- If all 6 fail fast (for example a short network drop) and time is left, the whole list is tried once more.
- If nothing works, the engine returns \`ok: false\`, with every model's error in \`error\`, and the Store Assistant answers without AI. It never crashes the caller.

**Model retired?** Run **AI Model Finder** to list valid IDs, change \`"model"\` in that model's body, then run **AI Health Check**.`)}, [calledByStore, manualTest, sampleRequest, normalizeInput], { color: 4 });

export default workflow('store-ai-engine-v2', 'Store AI Engine (6 models, hard timeouts)', { settings: { executionOrder: 'v1', executionTimeout: 90, saveDataErrorExecution: 'all', callerPolicy: 'workflowsFromSameOwner' } })
  .add(calledByStore)
  .to(normalizeInput)
  .add(manualTest)
  .to(sampleRequest)
  .to(normalizeInput)
  .add(normalizeInput.onError(allFailed))
  .add(normalizeInput)
  .to(model1)
`;
MODELS.forEach((_, i) => {
  const next = i + 1 < MODELS.length ? `model${i + 2}` : 'timeLeft';
  engine += `  .add(model${i + 1}.onError(${next}))
  .add(model${i + 1})
  .to(check${i + 1})
  .add(check${i + 1}.onError(${next}))
  .add(check${i + 1})
  .to(returnResult)
`;
});
engine += `  .add(timeLeft.onTrue(waitBeforeRetry).onFalse(allFailed))
  .add(waitBeforeRetry)
  .to(model1)
  .add(allFailed)
  .to(returnResult)
  .add(guide);
`;
fs.writeFileSync(path.join(__dirname, 'engine2.sdk.ts'), engine);

// ---------------------------------------------------------------- AI Health Check
const REPORT = `// One line per model: does it answer, and what did it say? Run this after changing a model ID.
const MODELS = ${js(MODELS.map((m, i) => ({ node: modelName(i), provider: m.provider, model: m.model })))};
const report = MODELS.map(m => {
  let r = {};
  try { r = $(m.node).first(0)?.json ?? {}; } catch (e) { r = { error: e.message }; }
  const content = r.choices?.[0]?.message?.content
    ?? (r.candidates?.[0]?.content?.parts ?? []).map(p => p?.text ?? '').join('');
  const text = typeof content === 'string' ? content.replace(/<think>[\\s\\S]*?<\\/think>/gi, '').trim() : '';
  const e = r.error;
  const error = typeof e === 'string' ? e : e?.message ?? '';
  return { ...m, works: Boolean(text), answer: text.slice(0, 160), error: text ? '' : (error || 'no answer').slice(0, 300) };
});
return [{ json: { working: report.filter(r => r.works).length, of: report.length, models: report } }];
`;
let hc = `import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';

const start = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Check All Models', position: [0, 300] },
  output: [{}]
});

const testPrompt = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Input',
    parameters: { mode: 'runOnceForAllItems', jsCode: ${js(`// The same test question for every model.
const system = 'You are a helpful shop assistant. Reply with ONLY this JSON: {"reply": "short answer in Thai"}';
const prompt = 'สวัสดีครับ ร้านเปิดกี่โมง';
return [{ json: {
  system,
  prompt,
  messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
  max_tokens: 1024,
  reasoning_effort: 'medium',
} }];
`)} },
    position: [240, 300]
  },
  output: [{ messages: [], max_tokens: 1024 }]
});
`;
MODELS.forEach((m, i) => {
  hc += httpNode(`model${i + 1}`, i, 480 + 240 * i, 300, String(m.cap + 5000), "onError: 'continueRegularOutput',\n    alwaysOutputData: true,");
});
hc += `
const healthReport = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Health Report', parameters: { mode: 'runOnceForAllItems', jsCode: ${js(REPORT)} }, position: [${480 + 240 * MODELS.length}, 300] },
  output: [{ working: 6, of: 6, models: [] }]
});

const note = sticky(${js(`## AI Health Check

Sends one short test question to each of the 6 models the **Store AI Engine** uses and lists which ones answer (**Health Report**).

Run it after changing a model ID, or when answers look degraded. A model that fails here is simply skipped by the engine, but fix it soon: every working model is one more backup.`)}, [start, testPrompt], { color: 5 });

export default workflow('ai-health-check', 'AI Health Check')
  .add(start)
  .to(testPrompt)
${MODELS.map((_, i) => `  .to(model${i + 1})`).join('\n')}
  .to(healthReport)
  .add(note);
`;
fs.writeFileSync(path.join(__dirname, 'healthcheck.sdk.ts'), hc);
console.log('engine2.sdk.ts', engine.length, 'chars; healthcheck.sdk.ts', hc.length, 'chars');
