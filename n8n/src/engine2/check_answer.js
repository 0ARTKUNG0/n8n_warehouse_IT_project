// Accept the answer only if it is usable. Throwing here hands the request to the next model.
const MODEL = __MODEL__;
const POSITION = __POSITION__;
const cfg = $('Normalize Input').first(0).json;
const r = $input.first()?.json ?? {};
// n8n keeps only the first line of a Code node error, and only the text after its last ":",
// so error messages here are one line and use " - " instead
const fail = msg => { throw new Error(String(msg).replace(/\s+/g, ' ').replace(/\s*:\s*/g, ' - ')); };

// OpenAI-style reply (Groq, Gemini, Typhoon, OpenRouter); Gemini's own format as a fallback
const content = r.choices?.[0]?.message?.content;
let text = typeof content === 'string' ? content
  : Array.isArray(content) ? content.map(p => p?.text ?? '').join('')
  : (r.candidates?.[0]?.content?.parts ?? []).map(p => p?.text ?? '').join('');
text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
if (!text) {
  const why = r.error?.message ?? r.choices?.[0]?.finish_reason ?? 'no content';
  fail(`${MODEL} - empty answer (${why})`);
}

let data = null;
if (cfg.expect_json) {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) fail(`${MODEL} - answer is not JSON - ${text.slice(0, 200)}`);
  try {
    data = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    fail(`${MODEL} - invalid JSON (${e.message}) - ${text.slice(0, 200)}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(`${MODEL} - JSON is not an object`);
  const missing = cfg.required_keys.filter(k => !(k in data));
  if (missing.length) fail(`${MODEL} - JSON is missing ${missing.join(', ')}`);
}

return [{ json: { ok: true, tier: POSITION, model: MODEL, text, data } }];
