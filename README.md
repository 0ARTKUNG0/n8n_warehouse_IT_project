# IT Warehouse: n8n store chat and inventory sync

Two n8n workflows for a computer-hardware store:

| Workflow | What it does |
|---|---|
| **IT Warehouse - Store Chat** (`workflows/store-chat.json`) | The website's chat. `POST /webhook/store-assistant` with `{ "session_id", "message" }`. A **Router** AI Agent sends the message to **Hardware Expert**, **Calculator** or **Troubleshooter**, and it answers `{ "ok", "agent", "reply" }`. |
| **IT Warehouse - Inventory Sync** (`workflows/inventory-sync.json`) | Every 5 minutes, copies `inventory.xlsx` (sheet `Inventory`) from Google Drive into the n8n Data Table `inventory` that the chat reads. |

**Durability:** every step has Retry On Fail (3 tries). Every AI Agent uses Groq first and switches to Gemini automatically if Groq fails. If both fail, the customer gets a polite "please try again". Each workflow emails you (Error Trigger → Gmail) if it crashes.

**Sold-out products:** the Hardware Expert first asks what the customer will use the product for, then recommends in-stock alternatives. The chat remembers the last 8 messages per `session_id`.

## Setup
1. In n8n, reconnect the **Google Drive account** credential.
2. Upload `inventory.xlsx` to Google Drive (template: `inventory/inventory_template.xlsx`, sheet `Inventory`).
3. In both workflows, open **Email Alert** and enter your email address.
4. In **Store Chat → Store Info**, fill in your contact, hours and policies.
5. Open **Inventory Sync**, click **Sync Now** once, then **Publish** both workflows.
6. Call `https://<your-n8n>/webhook/store-assistant` from your website's server (the webhook has no login).

`workflows/*.ts` are the same workflows as n8n Workflow SDK code. `HANDOFF_PROMPT.md` is a ready-made prompt for writing the project document, draw.io diagram and slides.
