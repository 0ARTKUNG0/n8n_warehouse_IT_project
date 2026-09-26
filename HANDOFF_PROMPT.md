# Handoff: IT Warehouse Store Chat

All files are on GitHub: https://github.com/0ARTKUNG0/n8n_warehouse_IT_project/tree/claude/n8n-mcp-connection-95o1dp

## Where things are
- n8n workflow **IT Warehouse - Store Chat** (one workflow, 24 nodes). `workflows/store-chat.json` is its export.
- Google Sheet **pc_parts_inventory** with the tabs `Inventory` (2,964 products) and `Orders` (one row per placed order).

## Still to do in n8n
1. **Reload the n8n page** before you edit, because the workflow was changed from outside the editor.
2. **Store Info**: fill in the contact, opening hours, warranty and return policy.
3. **Email Alert**: put your email address in *To*.
4. **Publish** the workflow. Your website and front-store app call `https://<your-n8n>/webhook/store-assistant`.
5. **Test that orders are logged.** The first test order (ORD-MUIYOFU5) lowered the stock but wasn't logged, because the `Orders` tab didn't exist yet. After publishing, run this in Windows PowerShell and check for a new row in `Orders`:
   ```powershell
   $u = "https://<your-n8n>/webhook/store-assistant"
   Invoke-RestMethod $u -Method Post -ContentType "application/json; charset=utf-8" -Body '{"session_id":"test-9","mode":"order","message":"Order: Ryzen 5 5600X x1"}'
   Invoke-RestMethod $u -Method Post -ContentType "application/json; charset=utf-8" -Body '{"session_id":"test-9","mode":"order","message":"Confirm, deliver to Bang Na branch"}'
   ```

Optional:
- **Protect the webhook.** Anyone who knows the webhook URL can place orders and lower the stock. Turn on *Webhook → Authentication → Header Auth* and send the same header from your website and front-store app.
- **Clean up the product names.** 59 product names in your sheet have broken symbols (like "fÃ¼r"). The new `inventory/pc_parts_inventory.xlsx` has clean names. If you re-import it, pick the Sheet again in *Get Products*.
- **Check one price.** SIBU-084 (Corsair DDR4 16GB) costs only ฿379 in the source data, which looks like a mistake.
- **Stock taken by the test order:** 1 each of V513-057R, 100-100000065BOX and SIBU-084.

## Prompt for normal Claude (document, draw.io diagram, slides)
Copy everything below the line into a new Claude chat. If you can, also attach
`workflows/store-chat.json`.

---

I built an n8n automation for my computer-hardware store (IT Warehouse, Thailand). Please help me make:
1. a **project document** (Word/.docx) explaining the system,
2. a **workflow diagram** for **draw.io** (give me draw.io XML I can import with *Extras → Edit Diagram*),
3. a **presentation** (PowerPoint/.pptx, about 8–10 slides).

Write them in **[Thai / English — choose one]**. Keep the language simple. Here is how the system works.

## Goal
The store website has a chat. Customers ask about products, prices and problems. An AI answers using the real product list, which the owner keeps in a **Google Sheet**. The chat reads the sheet on every message, so changes show up in real time. Front stores (the shop's branches) also order PC parts from the warehouse through it, and the stock in the sheet goes down automatically. The system must keep working when something fails (AI rate limits, errors, timeouts).

## The workflow: "IT Warehouse - Store Chat" (one n8n workflow)
Trigger: **Webhook** `POST /webhook/store-assistant`, body `{ "session_id": "...", "message": "..." }` (a sold-out product page can send `product_sku` without a message).
Reply: `{ "ok": true, "agent": "Order Desk | Hardware Expert | Calculator | Troubleshooter", "reply": "..." }`.

Steps, in order:
1. **Webhook**: receives the customer's message.
2. **Store Info** (Set node): store name, contact, opening hours, warranty/return policy. The owner edits this.
3. **Get Products** (Google Sheets node): reads all rows from the Google Sheet, tab *Inventory*, with columns sku, name, category, price_ex_vat, stock_qty, image_url, description, tags. The sheet holds 2,964 PC parts in 10 categories (CPU, CPU cooler, case, GPU, HDD, monitor, motherboard, PSU, RAM, SSD), converted from a PC-parts dataset: prices from US dollars at 1 USD = 35 THB, sample stock numbers, no images.
4. **Prepare Request** (Code): cleans the message and picks only the ~30 products that match the question (product type in Thai or English, model names like "RTX 4070", plus in-stock alternatives at a similar price; a follow-up like "for gaming" keeps the previous search), because the full list is too big to send to the AI every time. It turns them into text: SKU, name, category, price before and incl. VAT 7%, in stock / SOLD OUT, tags, description.
5. **Router** (AI Agent): reads the message and answers one word, *order*, *hardware*, *calculator* or *troubleshooter*.
6. **Route** (Switch): sends the message to one of four specialist AI Agents:
   - **Hardware Expert**: recommends products for the customer's use (gaming, office, design) and checks that PC parts fit together (CPU socket, RAM type, power supply watts). **Sold-out rule:** if the product is sold out, it first asks *"What will you use it for?"*, then recommends 1–3 in-stock alternatives with one trade-off each.
   - **Calculator**: prices, totals and VAT 7% for quantities, using a **Calculator tool** so the math is exact.
   - **Troubleshooter**: numbered fix steps, warranty/returns from Store Info, hands over to staff when needed.
   - **Order Desk** (front-store orders): a front store sends a PC spec. It matches every part to a SKU, checks stock and compatibility, recommends in-stock alternatives for sold-out parts, shows the total incl. VAT and asks to confirm. After the front store confirms, it asks for the store location. Then deterministic steps take over: **Check Order** (Code) re-checks every SKU and quantity against the live sheet, **Update Stock** (Google Sheets) lowers stock_qty, **Log Order** adds a row to the *Orders* tab, and **Order Confirmation** replies with the order number. The AI never changes stock itself.
   The Router has its own small memory so follow-ups like "yes" or a branch name go back to the Order Desk; a front-store app can also send `"mode": "order"`.
7. **Reply to Website** (Respond to Webhook): sends the answer back.
8. Separate small branch: **Error Trigger → Email Alert (Gmail)**, which emails the owner if the workflow fails.

AI sub-nodes shared by all four agents:
- **Groq (main model)**: `openai/gpt-oss-120b`.
- **Gemini (backup model)**: `gemini-flash-latest`. Each AI Agent has "fallback model" on, so if Groq fails (rate limit, error), the agent automatically uses Gemini.
- **Chat Memory** (Simple Memory, per session_id, last 8 messages): lets the Sold-out rule and the Order Desk's quote → confirm → location steps work over several messages.

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
(These three ran while products came from an n8n table; the AI part is unchanged.)
- Front-store order, with the Google Sheet (2,964 products): "Ryzen 5 5600X, DDR4 16GB RAM, RTX 4070, 1 each". The Order Desk matched all three parts, checked stock and that they fit together (AM4, DDR4, 200 W card) and showed the total, ฿29,173.55 incl. VAT (6 s). After "confirm, send to Bang Na branch", Check Order placed order ORD-MUIYOFU5 and Update Stock lowered each part's stock_qty by 1 in the sheet (4 s).

## Tools used
n8n (self-hosted, reached through ngrok), Groq API (free tier), Google Gemini API (free tier), Google Sheets, Gmail.

For the draw.io diagram: the main flow left to right (Webhook → Store Info → Get Products → Prepare Request → Router → Route), the Route splitting into the 4 agents; Hardware Expert, Calculator and Troubleshooter go straight to Reply to Website; the Order Desk goes to Check Order → Place Order? (yes: Split Stock Updates → Update Stock → Log Order → Order Confirmation → Reply to Website; no: straight to Reply to Website); the Groq/Gemini/Chat Memory sub-nodes attached to the agents with dashed lines (the Router has its own Router Memory), the Calculator tool attached to Calculator and Order Desk, the Google Sheet (tabs Inventory and Orders) as the data source for Get Products, Update Stock and Log Order, and the separate Error Trigger → Email Alert branch.
