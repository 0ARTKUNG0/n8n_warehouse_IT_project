# IT Warehouse: n8n store chat

One n8n workflow, **IT Warehouse - Store Chat** (`workflows/store-chat.json`), for a computer-hardware store's website chat.

- The website sends `POST /webhook/store-assistant` with `{ "session_id", "message" }` and gets back `{ "ok", "agent", "reply" }`.
- **Get Products** reads the product list from a **Google Sheet** (tab `Inventory`) on every message, so changes show up right away.
- **Prepare Request** sends the AI only the ~30 products that match the question (product type in Thai or English, model names like "RTX 4070", similar-priced alternatives). The full list is too big to send every time. A follow-up like "for gaming" keeps the previous search.
- The Hardware Expert checks that PC parts fit together (CPU socket, RAM type, power supply watts).
- A **Router** AI Agent sends the message to **Hardware Expert**, **Calculator** or **Troubleshooter**.
- **Sold-out products:** the Hardware Expert first asks what the customer will use the product for, then recommends in-stock alternatives. The chat remembers the last 8 messages per `session_id`.

**Durability:**
- Every step has Retry On Fail (3 tries).
- Every AI Agent uses Groq first and switches to Gemini automatically if Groq fails. If both fail, the customer gets a polite "please try again".
- If the Google Sheet can't be read, the chat still replies, without product details.
- If the workflow crashes, it emails you (Error Trigger → Gmail).

## Setup
1. **Make the Google Sheet.** In Google Sheets choose **File → Import** and upload `inventory/pc_parts_inventory.xlsx`: 2,964 PC parts in 10 categories, built from the PC-parts CSV files by `inventory/build_pc_parts_sheet.js`. Prices were converted from US dollars at 1 USD = 35 THB. **`stock_qty` is sample data** (about 1 in 10 is sold out) for you to replace. The data has no pictures, so `image_url` is empty. The tab must be named `Inventory`, with the columns `sku, name, category, price_ex_vat, stock_qty, image_url, description, tags`.
2. In n8n, **reconnect** the **Google Sheets account** credential. To stop it expiring every 7 days, publish your OAuth app in Google Cloud (**OAuth consent screen → Publish app**).
3. In **Store Chat → Get Products**, pick your sheet under **Document**.
4. Fill in **Store Info** (contact, hours, policies) and your address in **Email Alert**.
5. **Publish** the workflow and call `https://<your-n8n>/webhook/store-assistant` from your website's server (the webhook has no login).

`workflows/store-chat.ts` is the same workflow as n8n Workflow SDK code. `HANDOFF_PROMPT.md` is a ready-made prompt for writing the project document, draw.io diagram and slides.
