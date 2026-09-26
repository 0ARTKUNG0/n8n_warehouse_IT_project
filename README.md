# IT Warehouse: n8n store chat

One n8n workflow, **IT Warehouse - Store Chat** (`workflows/store-chat.json`), for a computer-hardware store's website chat.

- The website sends `POST /webhook/store-assistant` with `{ "session_id", "message" }` and gets back `{ "ok", "agent", "reply" }`.
- **Get Products** reads the product list from a **Google Sheet** (tab `Inventory`) on every message, so changes show up right away.
- A **Router** AI Agent sends the message to **Hardware Expert**, **Calculator** or **Troubleshooter**.
- **Sold-out products:** the Hardware Expert first asks what the customer will use the product for, then recommends in-stock alternatives. The chat remembers the last 8 messages per `session_id`.

**Durability:**
- Every step has Retry On Fail (3 tries).
- Every AI Agent uses Groq first and switches to Gemini automatically if Groq fails. If both fail, the customer gets a polite "please try again".
- If the Google Sheet can't be read, the chat still replies, without product details.
- If the workflow crashes, it emails you (Error Trigger → Gmail).

## Setup
1. **Make the Google Sheet.** In Google Sheets choose **File → Import**, upload `inventory/inventory_template.xlsx`, then edit the products. The tab must be named `Inventory`, with the columns `sku, name, category, price_ex_vat, stock_qty, image_url, description, tags`.
2. In n8n, **reconnect** the **Google Sheets account** credential. To stop it expiring every 7 days, publish your OAuth app in Google Cloud (**OAuth consent screen → Publish app**).
3. In **Store Chat → Get Products**, pick your sheet under **Document**.
4. Fill in **Store Info** (contact, hours, policies) and your address in **Email Alert**.
5. **Publish** the workflow and call `https://<your-n8n>/webhook/store-assistant` from your website's server (the webhook has no login).

`workflows/store-chat.ts` is the same workflow as n8n Workflow SDK code. `HANDOFF_PROMPT.md` is a ready-made prompt for writing the project document, draw.io diagram and slides.
