// Save the customer message and the reply to chat_log (runs after the reply was already sent).
try {
  const r = $('Normalize Request').first(0).json;
  const res = $input.first()?.json ?? {};
  if (!r.session_id) return [];
  const rows = [];
  if (r.message) rows.push({ session_id: r.session_id, role: 'customer', agent: '', content: r.message.slice(0, 2000) });
  if (res.reply) rows.push({ session_id: r.session_id, role: 'assistant', agent: String(res.agent ?? ''), content: String(res.reply).slice(0, 2000) });
  return rows.map(json => ({ json }));
} catch (e) {
  return [];
}
