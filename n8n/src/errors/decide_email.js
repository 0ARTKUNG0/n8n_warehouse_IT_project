// Email at most once an hour for the same workflow and error message, so an outage can't flood the inbox.
// Every error is still logged in the Error Handling table.
// Alerts sent with always_email (Inventory Sync) are already rate-limited by their sender and always go out.
const cur = $('Summarize Error').first(0).json;
const since = Date.now() - 60 * 60 * 1000;
const recent = $input.all()
  .map(i => i.json)
  .filter(r => r && r.createdAt && Date.parse(r.createdAt) >= since);
const same = recent.filter(r => String(r.error_detail ?? '').split('\n')[0] === cur.message);

return [{ json: { ...cur, send_email: cur.always_email === true || same.length === 0, repeats_last_hour: same.length } }];
