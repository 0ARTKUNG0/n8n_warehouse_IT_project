# Prompt to continue in normal Claude

Copy everything below the line into a new Claude chat. If you can, also attach
`workflows/store-chat.json` from this repository.

---

I built an n8n automation for my computer-hardware store (IT Warehouse, Thailand). Please help me make:
1. a **project document** (Word/.docx) explaining the system,
2. a **workflow diagram** for **draw.io** (give me draw.io XML I can import with *Extras → Edit Diagram*),
3. a **presentation** (PowerPoint/.pptx, about 8–10 slides).

Write them in **[Thai / English — choose one]**. Keep the language simple. Here is how the system works.

## Goal
The store website has a chat. Customers ask about products, prices and problems. An AI answers using the real product list, which the owner keeps in a **Google Sheet**. The chat reads the sheet on every message, so changes show up in real time. The system must keep working when something fails (AI rate limits, errors, timeouts).

## The workflow: "IT Warehouse - Store Chat" (one n8n workflow)
Trigger: **Webhook** `POST /webhook/store-assistant`, body `{ "session_id": "...", "message": "..." }` (a sold-out product page can send `product_sku` without a message).
Reply: `{ "ok": true, "agent": "Hardware Expert | Calculator | Troubleshooter", "reply": "..." }`.

Steps, in order:
1. **Webhook**: receives the customer's message.
2. **Store Info** (Set node): store name, contact, opening hours, warranty/return policy. The owner edits this.
3. **Get Products** (Google Sheets node): reads all rows from the Google Sheet, tab *Inventory*, with columns sku, name, category, price_ex_vat, stock_qty, image_url, description, tags. The sheet holds 2,964 PC parts in 10 categories (CPU, CPU cooler, case, GPU, HDD, monitor, motherboard, PSU, RAM, SSD), converted from a PC-parts dataset: prices from US dollars at 1 USD = 35 THB, sample stock numbers, no images.
4. **Prepare Request** (Code): cleans the message and picks only the ~30 products that match the question (product type in Thai or English, model names like "RTX 4070", plus in-stock alternatives at a similar price; a follow-up like "for gaming" keeps the previous search), because the full list is too big to send to the AI every time. It turns them into text: SKU, name, category, price before and incl. VAT 7%, in stock / SOLD OUT, tags, description.
5. **Router** (AI Agent): reads the message and answers one word, *hardware*, *calculator* or *troubleshooter*.
6. **Route** (Switch): sends the message to one of three specialist AI Agents:
   - **Hardware Expert**: recommends products for the customer's use (gaming, office, design) and checks that PC parts fit together (CPU socket, RAM type, power supply watts). **Sold-out rule:** if the product is sold out, it first asks *"What will you use it for?"*, then recommends 1–3 in-stock alternatives with one trade-off each.
   - **Calculator**: prices, totals and VAT 7% for quantities, using a **Calculator tool** so the math is exact.
   - **Troubleshooter**: numbered fix steps, warranty/returns from Store Info, hands over to staff when needed.
7. **Reply to Website** (Respond to Webhook): sends the answer back.
8. Separate small branch: **Error Trigger → Email Alert (Gmail)**, which emails the owner if the workflow fails.

AI sub-nodes shared by all four agents:
- **Groq (main model)**: `openai/gpt-oss-120b`.
- **Gemini (backup model)**: `gemini-flash-latest`. Each AI Agent has "fallback model" on, so if Groq fails (rate limit, error), the agent automatically uses Gemini.
- **Chat Memory** (Simple Memory, per session_id, last 8 messages): lets the Sold-out rule work over two messages.

## How it stays working (durability)
- **Retry On Fail on every step** (3 tries, 2–5 s apart).
- **Two AI models per agent**: Groq first, Gemini as automatic backup.
- If both AI models fail, the customer gets a polite "please try again" message instead of an error.
- If the Google Sheet can't be read, the chat still replies, just without product details.
- Incomplete sheet rows (no SKU, name or price) are skipped instead of breaking the answer.
- An **Error Trigger → Gmail** alert emails the owner if the workflow fails.

## Tested (live, in n8n)
- A customer asks for a sold-out mouse: the Router picks Hardware Expert, which says it is sold out and asks what it will be used for (1.5 s).
- A price question "2 × MS-002 and 1 × KB-002 incl. VAT": the Router picks Calculator, which uses the Calculator tool: ฿4,670.00 + VAT ฿326.90 = ฿4,996.90 (3 s).
- Backup test: with Groq deliberately broken, the Router switched to Gemini and still answered. When Gemini was also overloaded (Google returned 503), the customer got the polite "please try again" message instead of an error.
(These tests ran while products came from an n8n table. The product list now comes from the Google Sheet; the AI part is unchanged.)

## Tools used
n8n (self-hosted, reached through ngrok), Groq API (free tier), Google Gemini API (free tier), Google Sheets, Gmail.

For the draw.io diagram: the main flow left to right (Webhook → Store Info → Get Products → Prepare Request → Router → Route), the Route splitting into the 3 agents which all join into Reply to Website, the Groq/Gemini/Memory sub-nodes attached to the agents with dashed lines, the Calculator tool attached to Calculator, the Google Sheet as a data source for Get Products, and the separate Error Trigger → Email Alert branch.
