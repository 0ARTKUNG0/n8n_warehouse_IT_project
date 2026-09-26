# Prompt to continue in normal Claude

Copy everything below the line into a new Claude chat. If you can, also attach
`workflows/store-chat.json` and `workflows/inventory-sync.json` from this repository.

---

I built an n8n automation for my computer-hardware store (IT Warehouse, Thailand). Please help me make:
1. a **project document** (Word/.docx) explaining the system,
2. a **workflow diagram** for **draw.io** (give me the draw.io XML I can import with *Arrange → Insert → Advanced → From Text / Extras → Edit Diagram*),
3. a **presentation** (PowerPoint/.pptx, about 8–10 slides).

Write them in **[Thai / English — choose one]**. Keep the language simple. Here is how the system works.

## Goal
The store website has a chat. Customers ask about products, prices and problems. An AI answers using the real product list, which the owner keeps in an Excel file on Google Drive. The system must keep working when something fails (AI rate limits, errors, timeouts).

## Workflow 1: "IT Warehouse - Store Chat"
Trigger: **Webhook** `POST /webhook/store-assistant`, body `{ "session_id": "...", "message": "..." }` (from a sold-out product page the website can send `product_sku` without a message).
Reply: `{ "ok": true, "agent": "Hardware Expert | Calculator | Troubleshooter", "reply": "..." }`.

Steps, in order:
1. **Webhook**: receives the customer's message.
2. **Store Info** (Set node): store name, contact, opening hours, warranty/return policy. The owner edits this.
3. **Get Products** (n8n Data Table `inventory`): reads all products.
4. **Prepare Request** (Code): cleans the message and turns the product list into text: SKU, name, category, price before and incl. VAT 7%, in stock / SOLD OUT, tags, description.
5. **Router** (AI Agent): reads the message and answers one word, *hardware*, *calculator* or *troubleshooter*.
6. **Route** (Switch): sends the message to one of three specialist AI Agents:
   - **Hardware Expert**: recommends products for the customer's use (gaming, office, design). **Sold-out rule:** if the product is sold out, it first asks *"What will you use it for?"*, then recommends 1–3 in-stock alternatives with one trade-off each.
   - **Calculator**: prices, totals and VAT 7% for quantities, using a **Calculator tool** so the math is exact.
   - **Troubleshooter**: numbered fix steps, warranty/returns from Store Info, hands over to staff when needed.
7. **Reply to Website** (Respond to Webhook): sends the answer back.

AI sub-nodes shared by all four agents:
- **Groq (main model)**: `openai/gpt-oss-120b`.
- **Gemini (backup model)**: `gemini-flash-latest`. Each AI Agent has "fallback model" on, so if Groq fails (rate limit, error), the agent automatically uses Gemini.
- **Chat Memory** (Simple Memory, per session_id, last 8 messages): lets the Sold-out rule work over two messages.

## Workflow 2: "IT Warehouse - Inventory Sync"
Every 5 minutes (or **Sync Now** by hand):
1. **Find inventory.xlsx** on Google Drive,
2. **Download File**,
3. **Read Excel Rows** (sheet *Inventory*; columns sku, name, category, price_ex_vat, stock_qty, image_url, description, tags),
4. **Clean Rows** (Code): skips rows with mistakes (no SKU/name, bad price or stock, duplicate SKU), so a product keeps its last good values,
5. **Save Products**: upsert into the Data Table `inventory` (matched by SKU).

## How it stays working (durability)
- **Retry On Fail on every step** (3 tries, 2–5 s apart).
- **Two AI models per agent**: Groq first, Gemini as automatic backup.
- If an AI agent still fails, the customer gets a polite "please try again" instead of an error.
- The chat reads the product list from n8n's own table, not from Google Drive, so a Drive problem never stops the chat. It uses the last good list.
- Bad spreadsheet rows are skipped instead of breaking the sync.
- Each workflow has an **Error Trigger → Gmail** alert that emails the owner if the workflow fails.

## Tested (live, in n8n)
- A customer asks for a sold-out mouse: the Router picks Hardware Expert, which says it is sold out and asks what it will be used for (1.5 s).
- A price question "2 × MS-002 and 1 × KB-002 incl. VAT": the Router picks Calculator, which uses the Calculator tool: ฿4,670.00 + VAT ฿326.90 = ฿4,996.90 (3 s).
- Backup test: with Groq deliberately broken, the Router switched to Gemini and still answered. When Gemini was also overloaded (Google returned 503), the customer got the polite "please try again" message instead of an error.

## Tools used
n8n (self-hosted, reached through ngrok), Groq API (free tier), Google Gemini API (free tier), Google Drive, Gmail, n8n Data Tables.

For the draw.io diagram: two lanes (Store Chat, Inventory Sync), the nodes above as boxes with arrows, the Router → 3 agents branch, the Groq/Gemini/Memory sub-nodes attached to the agents with dashed lines, and the shared Data Table `inventory` connecting both workflows.
