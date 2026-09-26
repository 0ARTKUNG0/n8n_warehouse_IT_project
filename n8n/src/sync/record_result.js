// What happened in this run, and should the owner hear about it?
// Email when the sync has failed twice in a row (so a one-off Google Drive hiccup that fixes itself
// stays quiet), when it works again after that email, and when the list of spreadsheet problems changes.
// Never every 5 minutes for the same thing.
const ALERT_AFTER_FAILS = 2;  // failed runs in a row before emailing (runs are 5 minutes apart)
const txt = v => String(v ?? '').trim();
const errText = e => (typeof e === 'string' ? e : e?.message ?? JSON.stringify(e ?? ''))
  .replace(/\s*\[line \d+[^\]]*\]\s*$/, '').trim().slice(0, 500);
const sentence = s => (/[.!?]$/.test(s) ? s : `${s}.`);
const STEPS = ['Pick Inventory File', 'Download File', 'Validate & Clean'];  // the steps with an error output

let last = {};
try { last = $('Load Last Status').first(0)?.json ?? {}; } catch (e) {}
const input = $input.first()?.json ?? {};

let ok, message, problems = [], fileSignature = '', applied = false;
if (input.error) {
  // a step failed before anything changed: find which one
  let step = 'A step';
  for (const s of STEPS) {
    try { if ($(s).isExecuted && $(s).all(1).length) { step = s; break; } } catch (e) {}
  }
  ok = false;
  message = `Inventory sync failed at "${step}": ${sentence(errText(input.error))} The chat keeps using the last good product list.`;
} else {
  const v = $('Validate & Clean').first(0).json;
  problems = v.problems ?? [];
  fileSignature = txt(v.problems_signature);
  if (!v.safe) {
    ok = false;
    message = `Inventory sync blocked, nothing was changed. ${v.reason}`;
  } else {
    applied = true;
    const r = input;  // from Removals Done
    const failures = (r.save_failed ?? 0) + (r.delete_failed ?? 0);
    ok = failures === 0;
    message = `Synced ${v.products_in_file} products: ${r.saved ?? 0} added or updated, ${r.deleted ?? 0} removed.`
      + (failures ? ` ${failures} change(s) could not be saved and will be retried on the next sync.` : '')
      + (problems.length ? ` ${problems.length} row(s) in the spreadsheet need fixing.` : '');
  }
}

const fails = ok ? 0 : (Number(last.fails) || 0) + 1;
const wasAlerted = last.down_alerted === true;
const broke = !ok && !wasAlerted && fails >= ALERT_AFTER_FAILS;
const recovered = ok && wasAlerted;
const down_alerted = !ok && (wasAlerted || broke);
// Row problems are only news when the file was applied; a failed or blocked run keeps the last known list.
const signature = applied ? fileSignature : txt(last.problems_signature);
const newProblems = applied && signature !== '' && signature !== txt(last.problems_signature);
const alert = broke || recovered || newProblems;

const lines = problems.slice(0, 25).map(p => `- ${p.product}: ${p.issue} (${p.action})`);
const detail = [message, lines.length ? `\nRows to fix in the spreadsheet:\n${lines.join('\n')}` : ''].join('\n').trim();
const subject = !alert ? ''
  : broke ? 'Inventory sync stopped'
  : recovered ? 'Inventory sync works again'
  : `Spreadsheet rows need fixing: ${problems[0]?.product ?? ''}${problems.length > 1 ? ` and ${problems.length - 1} more` : ''}`;

return [{ json: {
  ok, fails, down_alerted, message: message.slice(0, 1000), problems_signature: signature.slice(0, 4000),
  alert, alert_subject: subject.slice(0, 200), alert_detail: detail.slice(0, 4000),
} }];
