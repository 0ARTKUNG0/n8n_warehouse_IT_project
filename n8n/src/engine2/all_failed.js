// Every model failed (or the input was unusable). Return a normal result so the caller can fall back,
// with each model's error so the cause is easy to find in the execution log.
const STEPS = __STEPS__;
const reasons = [];
for (const step of STEPS) {
  try {
    if (!$(step).isExecuted) continue;
    const e = $(step).all(1).map(i => i.json?.error).find(Boolean);
    if (e) reasons.push(`${step}: ${typeof e === 'string' ? e : e.message ?? JSON.stringify(e)}`.slice(0, 220));
  } catch (x) {}
}
const e = $input.first()?.json?.error;
const last = typeof e === 'string' ? e : (e?.message ?? e?.description ?? '');
const error = (reasons.length ? reasons.join(' | ') : last || 'All AI providers failed').slice(0, 2000);

return [{ json: { ok: false, tier: 0, model: '', text: '', data: null, error } }];
