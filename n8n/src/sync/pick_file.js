// Pick the inventory file: an Excel file (inventory.xlsx) or a Google Sheet (inventory), newest first.
// Throws when the Drive search failed or found nothing, so the sync stops before anything in the product list changes.
const settings = $('Sync Settings').first(0).json;
const want = String(settings.file_name ?? 'inventory.xlsx').trim().toLowerCase().replace(/\.xlsx$/, '');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEET = 'application/vnd.google-apps.spreadsheet';
const errText = e => (typeof e === 'string' ? e : e?.message ?? JSON.stringify(e)).slice(0, 300);
// n8n keeps only the first line of a Code node error, and only the text after its last ":",
// so the messages here are one line and use " - " instead
const plain = s => String(s).replace(/\s+/g, ' ').replace(/\s*:\s*/g, ' - ').replace(/[.\s]+$/, '');

const found = $input.all().map(i => i.json ?? {});
const failed = found.find(f => f.error !== undefined && !f.id);  // Find Excel File passes its error on as an item
if (failed) throw new Error(`Google Drive search failed - ${plain(errText(failed.error))}`);

const files = found
  .filter(f => f.id && !f.trashed && [XLSX, SHEET].includes(f.mimeType))
  .filter(f => [want, `${want}.xlsx`].includes(String(f.name ?? '').trim().toLowerCase()))
  .sort((a, b) => String(b.modifiedTime ?? '').localeCompare(String(a.modifiedTime ?? '')));

if (!files.length) throw new Error(`No Excel file "${want}.xlsx" or Google Sheet "${want}" found in Google Drive`);
const f = files[0];
return [{ json: { id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime ?? '', other_copies: files.length - 1 } }];
