# IT Warehouse: n8n store assistant and inventory sync

An n8n system for a computer-hardware store:

- the website's chat talks to an **AI store assistant** with three specialists (Hardware Expert, Calculator, Troubleshooter),
- when a product is sold out, the **Suggestion chat** first asks what the customer will use it for, then recommends in-stock alternatives,
- the product list comes from an **Excel file on Google Drive**, synced every 5 minutes,
- every failure is **logged and emailed**, and the customer always gets an answer.

It is built to keep working when things break: AI rate limits, slow or dead AI providers, Google Drive outages, broken spreadsheets and crashed steps. See [How it stays up](#how-it-stays-up).

## The workflows

| Workflow (in n8n) | What it does | Runs on | Needs publishing |
|---|---|---|---|
| **Store Assistant (Storefront Chat API)** | The chat API the website calls | Webhook `POST /webhook/store-assistant` | Yes, when you go live |
| **Store AI Engine (6 models, hard timeouts)** | Every AI call: 6 models on 4 providers, with failover | Called by Store Assistant | Already published |
| **Inventory Sync (Google Drive Excel)** | Excel on Drive → `inventory` data table | Every 5 minutes, or **Sync Now** | Yes, after the setup below |
| **Error Handler (alerts and log)** | Logs failures to a data table and emails you | Any workflow failing, or an alert from Inventory Sync | Already published |
| **AI Health Check** | Asks all 6 models one question, reports which answer | By hand, after changing a model | No |

```
Website ──POST /webhook/store-assistant──► Store Assistant ──► Store AI Engine ──► Groq · Typhoon · Gemini · OpenRouter
                                              │   ▲
                                   chat_log ◄─┘   │ reads the product list
                                                  │
inventory.xlsx on Google Drive ──► Inventory Sync ┴──► inventory (data table)

Any failure ──► Error Handler ──► Error Handling (data table) + Gmail alert
```

## Setup checklist

1. **Reconnect Google Drive.** In n8n, open **Credentials → Google Drive account** and sign in again. The sync currently stops with *"The credential "Google Drive account" needs to be reconnected"*.
2. **Upload the product list.** Put `inventory/inventory_template.xlsx` (or your own file in the same format) in Google Drive, named exactly **`inventory.xlsx`**, with the products on a sheet named **`Inventory`**. A Google Sheet named **`inventory`** also works. See [The spreadsheet](#the-spreadsheet).
3. **Set the alert email.** Open **Error Handler → Email Alert**, enter the address that should get alerts, then click **Execute workflow** (the **Test Alert** trigger) to receive a test email.
4. **Fill in your store details.** Open **Store Assistant → Store Settings**: store name, contact (LINE / phone), opening hours, warranty and return policy, VAT rate. The assistant only states what is written there.
5. **Start the sync.** Open **Inventory Sync**, click **Sync Now** once and check the **sync_status** data table says `Synced …`, then **Publish** it.
6. **Go live.** **Publish** Store Assistant and point the website at `https://<your-n8n>/webhook/store-assistant`.
   The webhook has no authentication. Call it from your website's backend (not from the browser), or add Header Auth to the **Storefront Webhook** node and send the header from your backend.
7. *(Optional)* Delete the rows my tests left in **chat_log** (session ids such as `v2-sug-2`, `final-sug-1`) and in **Error Handling** (rows mentioning *Inventory Sync (test)* or *Error Handler (test)*).

## Storefront API

`POST /webhook/store-assistant` with a JSON body:

```json
{
  "session_id": "abc123",
  "mode": "chat",
  "message": "แนะนำเมาส์สำหรับเล่นเกม FPS หน่อย",
  "lang": "th",
  "context": { "stage": "", "product_sku": "" },
  "cart": [{ "sku": "MS-002", "qty": 2 }]
}
```

| Field | |
|---|---|
| `session_id` | Required. Keeps the conversation history (last 8 messages). |
| `mode` | `chat` (default), `suggestion` or `cart_total`. |
| `message` | Required in `chat` mode. Up to 1,000 characters. |
| `lang` | `th` or `en`. Optional: detected from the message. |
| `context.product_sku` | Required in `suggestion` mode: the sold-out product. |
| `context.stage` | `recommend` for the second turn of the Suggestion chat (see below). |
| `cart` | Required in `cart_total` mode. Up to 50 lines, `qty` 1–999. |

The reply always has the same shape, including when something failed:

```json
{
  "ok": true,
  "request_id": "274",
  "session_id": "abc123",
  "agent": "hardware_expert",
  "reply": "ขอแนะนำ ...",
  "products": [{ "sku": "MS-006", "name": "Kairo Pro Multi-Device Mouse", "image_url": "…", "price_ex_vat": 2790, "price_inc_vat": 2985.3, "stock_qty": 6 }],
  "totals": null,
  "next_stage": "recommend",
  "product_sku": "MS-007",
  "open_suggestion_sku": "",
  "needs_human": false,
  "degraded": false,
  "meta": { "routed_by": "ai", "ai_tier": 1 }
}
```

- `agent`: `hardware_expert`, `calculator`, `troubleshooter`, or `system` (the safe fallback reply).
- `totals` (Calculator and `cart_total` only): `lines[]`, `subtotal_ex_vat`, `vat`, `vat_rate`, `total_inc_vat`, `unmatched[]`. Money is calculated in code, never by the AI.
- `open_suggestion_sku`: the customer asked about a sold-out product in the normal chat. Open the Suggestion chat for this SKU.
- `next_stage: "recommend"`: send the customer's next message with `context.stage: "recommend"`.
- `needs_human`: troubleshooting couldn't solve it. Offer a handover to staff.
- `degraded`: the answer was made without AI or without the product list. It is still safe to show.
- An invalid request gets HTTP 400: `{ "ok": false, "request_id": "…", "errors": ["session_id is required"] }`.

**Suggestion chat (sold-out product):**

1. Send `mode: "suggestion"` with `context.product_sku` and no message. The reply asks what they will use it for.
2. Send their answer with `context.stage: "recommend"`. The reply recommends in-stock alternatives for that workload, each with its trade-off.

## The spreadsheet

One row per product on the sheet **`Inventory`**. The header names are not case-sensitive (`Stock Qty` works too):

| Column | Required | Notes |
|---|---|---|
| `sku` | yes | Unique. Stored in upper case. |
| `name` | yes | |
| `category` | yes | `mouse`, `keyboard`, `headset`, `monitor`, `webcam`, `mousepad`, `speaker` or `accessory`. Others are saved with a warning. |
| `price_ex_vat` | yes | Price before VAT. `1,290`, `฿1290` and `1290 บาท` are all fine. |
| `stock_qty` | yes | Whole number, `0` = sold out. |
| `image_url` | no | Must start with `http://` or `https://`. |
| `description` | no | What the assistant tells customers about the product (up to 1,000 characters). |
| `tags` | no | Comma-separated, e.g. `gaming,wireless,fps`. Used to match products to what the customer needs. |

What the sync does with your edits:

- A row with a mistake (empty price, text in `stock_qty`, duplicate SKU) is skipped. The product keeps its last good version, and you get one email listing the rows to fix.
- A product removed from the file is removed from the store.
- A file with far fewer products than the store has (under 30% of them, once the store has 10 or more) is **not applied**, in case it is the wrong file or sheet. If you meant it, set `allow_big_changes` to `true` in **Inventory Sync → Sync Settings**, click **Sync Now**, then set it back to `false`.

## How it stays up

**AI (Store AI Engine)**
- 6 models on 4 providers, tried in order: Groq GPT-OSS 120B → Groq Qwen 3.8 27B → Typhoon 2.5 (Thai) → Gemini Flash-Lite → Gemini Flash → OpenRouter Gemma 4 31B.
- A rate limit, error, bad answer or timeout moves the request to the next model at once. Every call has a hard timeout, and each request is kept within its deadline (10 s to pick a specialist, 28 s for an answer). If every model fails and time is left, the whole list is tried once more.
- The engine never crashes the caller. When everything fails it returns `ok: false`, and the assistant answers without AI.

**Store Assistant**
- Without AI, every specialist still answers: keyword routing, in-stock products that match the question, closest-price alternatives, the calculator in code, basic troubleshooting steps plus a handover to staff.
- Every step that can crash has an error route to **Emergency Reply**, so the website always gets a reply in the same shape.
- The product list or chat history unavailable? It answers without them, and a reply made without the product list is marked `degraded`.
- The AI can't invent products: an answer naming an SKU that isn't in the product list is replaced.

**Inventory Sync**
- The chat never reads Google Drive, only the `inventory` data table. Drive being down or a broken file never affects customers; they get the last good product list.
- Google Drive steps retry on their own (3 tries). Every step is safe to repeat, so anything that still fails is simply tried again 5 minutes later.
- The owner hears about it once: an email when the sync has failed **twice in a row** (a one-off hiccup that fixes itself stays quiet), one when it **works again**, and one when the **list of rows to fix changes**. The latest result is always in the `sync_status` data table.

**Error Handler**
- Store Assistant, Store AI Engine and Inventory Sync report failures here. Every failure is logged in the **Error Handling** data table and emailed, at most once an hour for the same error.

**Tested live**, on this n8n:
- **Store Assistant.** All three specialists, the Suggestion chat, cart totals, bad requests, English, multi-turn follow-ups. Answers take about 1–3.5 s.
  - With the AI engine unreachable, it still gives deterministic answers.
  - With the product list or chat history unreadable, it gives polite answers.
  - Failing chat-log writes don't crash it.
- **Store AI Engine.**
  - A hanging provider was skipped, and the next model answered in 7.9 s.
  - With every provider returning errors, it stopped cleanly with `ok: false` after 9.9 s.
- **Inventory Sync.** Eight scenarios, each checked against the data tables:
  - new product
  - rerun with no changes
  - product removed
  - Drive error
  - wrong sheet
  - unreadable product list
  - a 3-product file blocked
  - recovery
- **Alerts.** Real alerts went through the Error Handler to the log and to Gmail. Gmail rejects them until step 3 of the checklist is done.

## Data tables

| Table | Columns |
|---|---|
| `inventory` | `sku`, `name`, `category`, `price_ex_vat` (number), `stock_qty` (number), `image_url`, `description`, `tags` |
| `chat_log` | `session_id`, `role`, `agent`, `content` |
| `sync_status` | `key`, `ok` (boolean), `message`, `problems_signature`, `fails` (number), `down_alerted` (boolean) |
| `Error Handling` | `workflow_name`, `error_detail` |

## Changing the workflows

`n8n/workflows/` holds the workflows as n8n JSON (**Import from File** in n8n). They are generated from `n8n/src/`:

- `build_*.js`: the workflow definitions (n8n Workflow SDK)
- `main/`, `engine2/`, `errors/`, `sync/`: the JavaScript of every Code node
- `test_*.js`: tests that run the Code nodes outside n8n; `test_sync_excel.js` runs the sync checks on real Excel files

```bash
cd n8n/src
npm install
npm test        # all tests
npm run build   # regenerates n8n/workflows/*.json (and *.sdk.ts for the n8n MCP server)
```

The exports contain the ids of this n8n's workflows, credentials and data tables. Importing into another n8n needs those reselected: credentials, data tables, the AI Engine in Store Assistant, and the Error Handler in each workflow's settings.
