// Turn n8n's error report into one short record: which workflow, what failed, where, and a link.
// Also accepts an alert sent by another workflow: { workflow_name, message, detail, always_email }.
// Never throws: a strange report still produces a readable alert.
const e = $input.first()?.json ?? {};
const txt = v => String(v ?? '').trim();

if (!e.execution && !e.trigger && txt(e.message)) {
  const workflow_name = txt(e.workflow_name) || 'Unknown workflow';
  const message = txt(e.message).slice(0, 300);
  const error_detail = [message, txt(e.detail) !== message ? txt(e.detail) : ''].filter(Boolean).join('\n').slice(0, 4000);
  const always_email = e.always_email === true;  // the sender already decided this is worth an email
  return [{ json: { workflow_name, message, node: '', execution_id: '', execution_url: '', error_detail, always_email } }];
}

const ex = e.execution ?? {};
const wf = e.workflow ?? {};
const err = ex.error ?? e.trigger?.error ?? {};

const workflow_name = txt(wf.name) || 'Unknown workflow';
const message = (txt(err.message) || txt(err.description) || 'Unknown error').slice(0, 300);
const node = txt(ex.lastNodeExecuted || err.node?.name);
const execution_id = txt(ex.id);
const execution_url = txt(ex.url);

const error_detail = [
  message,
  node && `Node: ${node}`,
  execution_id && `Execution: ${execution_id}`,
  execution_url && `Open: ${execution_url}`,
  ex.mode && `Mode: ${ex.mode}`,
].filter(Boolean).join('\n').slice(0, 2000);

return [{ json: { workflow_name, message, node, execution_id, execution_url, error_detail, always_email: false } }];
