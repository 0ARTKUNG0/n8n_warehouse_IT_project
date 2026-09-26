// Suggestion-chat replies that need no AI (so they cannot fail):
// ask what the product is for, product back in stock, no alternatives, or product not found.
const c = $('Build Context').first(0).json;
const th = c.lang !== 'en';
const t = c.target;
const name = t?.name ?? '';
const card = p => ({ sku: p.sku, name: p.name, image_url: p.image_url, price_ex_vat: p.price_ex_vat, price_inc_vat: p.price_inc_vat, stock_qty: p.stock_qty });

let reply;
let products = [];
let next_stage = '';

switch (c.suggestion_kind) {
  case 'missing':
    reply = th
      ? 'ขออภัยครับ ตอนนี้ยังดึงข้อมูลสินค้านี้ไม่ได้ ลองพิมพ์ชื่อหรือประเภทสินค้าที่ต้องการ แล้วผมจะช่วยหารุ่นที่มีในสต็อกให้ครับ'
      : "Sorry, I can't load this product right now. Tell me the product or type you're looking for and I'll find in-stock options.";
    break;
  case 'in_stock':
    reply = th
      ? `ข่าวดีครับ ตอนนี้ ${name} มีสินค้าพร้อมส่งแล้ว (เหลือ ${t.stock_qty} ชิ้น)`
      : `Good news: ${name} is back in stock (${t.stock_qty} left).`;
    products = [card(t)];
    break;
  case 'none':
    reply = th
      ? `ขออภัยครับ ตอนนี้ยังไม่มีสินค้าในหมวดเดียวกับ ${name} ที่พร้อมส่ง ลองกลับมาดูอีกครั้งภายหลัง หรือสอบถามวันที่สินค้าเข้าได้ที่ ${c.store.store_contact}`
      : `Sorry, we don't have an in-stock alternative to ${name} right now. Please check back later or ask our staff about restock dates: ${c.store.store_contact}`;
    break;
  default: // 'ask': always ask what they will use it for before recommending
    reply = th
      ? `ขออภัยครับ ตอนนี้ ${name} หมดสต็อกชั่วคราว เพื่อแนะนำรุ่นทดแทนที่เหมาะกับคุณที่สุด ขอทราบว่าจะนำไปใช้งานแบบไหนครับ? เช่น เล่นเกมแข่งขัน (FPS/MOBA), เล่นเกมทั่วไป, งานออฟฟิศ/เรียน หรืองานกราฟิก/ตัดต่อ`
      : `Sorry, ${name} is out of stock right now. To recommend the best alternative, what will you be using it for? (e.g. competitive gaming, casual gaming, office/study, design/video editing)`;
    next_stage = 'recommend';
}

return [{ json: {
  agent: 'hardware_expert', reply, products, next_stage, product_sku: c.product_sku,
  degraded: false, ai_tier: 0,
} }];
