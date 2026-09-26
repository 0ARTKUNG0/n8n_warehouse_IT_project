// Input from the calling workflow: { role, system, prompt, expect_json, required_keys, budget_ms? }
// Builds the chat messages every model gets, and one deadline shared by all model calls,
// so the engine always answers in time even when a provider hangs.
const i = $input.first()?.json ?? {};
const prompt = String(i.prompt ?? '').trim();
if (!prompt) throw new Error('AI Engine received an empty prompt');

const role = String(i.role ?? 'general');
const system = String(i.system ?? '').trim() || 'You are a helpful assistant.';
// routing must be quick (the caller can route by keywords instead); answers get more time
const budget = Number(i.budget_ms) > 0 ? Math.min(Number(i.budget_ms), 55000) : role === 'router' ? 10000 : 28000;

return [{ json: {
  role,
  system,
  prompt,
  expect_json: i.expect_json === true || i.expect_json === 'true',
  required_keys: Array.isArray(i.required_keys) ? i.required_keys.map(String) : [],
  messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
  max_tokens: role === 'router' ? 1024 : 2048,
  // models that can reason: think a little for routing, more for customer answers (accuracy, language)
  reasoning_effort: role === 'router' ? 'low' : 'medium',
  budget_ms: budget,
  deadline: Date.now() + budget,
} }];
