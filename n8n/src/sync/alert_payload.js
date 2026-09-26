// The alert for the Error Handler: it logs it and emails the owner.
// always_email: this workflow already decides when to email, so the Error Handler must not hold it back.
const r = $('Record Result').first(0).json;
return [{ json: { workflow_name: 'Inventory Sync', message: r.alert_subject, detail: r.alert_detail, always_email: true } }];
