// A made-up error report (same shape n8n sends) to try the alert by hand: click Execute workflow.
return [{ json: {
  execution: {
    id: 'test',
    url: '',
    error: { message: 'Test alert: this is what a real error email looks like' },
    lastNodeExecuted: 'Sample Error',
    mode: 'manual',
  },
  workflow: { id: 'test', name: 'Error Handler (test)' },
} }];
