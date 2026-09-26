// Use the AI router's answer if it is valid; otherwise route by keywords (no API call, cannot fail).
const c = $('Build Context').first(0).json;
const res = $input.first()?.json ?? {};
const ROUTES = ['hardware_expert', 'calculator', 'troubleshooter'];

const aiRoute = String(res?.data?.route ?? '').trim().toLowerCase();
if (res.ok === true && ROUTES.includes(aiRoute)) {
  return [{ json: { route: aiRoute, routed_by: 'ai', ai_tier: res.tier ?? 0 } }];
}

const t = c.message.toLowerCase();
const rules = [
  ['troubleshooter', /(เสีย|พัง|ไม่ทำงาน|ใช้ไม่ได้|ไม่ติด|ค้าง|ไดรเวอร์|driver|เคลม|ประกัน|warranty|คืนสินค้า|คืนเงิน|refund|พัสดุ|ส่งของ|tracking|ออเดอร์|คำสั่งซื้อ|ชำระเงิน|โอนเงิน|broken|not working)/],
  ['calculator', /(vat|ภาษี|ราคารวม|รวมทั้งหมด|รวมเป็น|ยอดรวม|คิดเงิน|ใบเสนอราคา|total|quotation|\bx\s?\d|\d+\s?(ชิ้น|ตัว|อัน))/],
  ['hardware_expert', /(เมาส์|mouse|คีย์บอร์ด|keyboard|หูฟัง|headset|มอนิเตอร์|monitor|เว็บแคม|webcam|แผ่นรองเมาส์|ลำโพง|dpi|สวิตช์|switch|แนะนำ|recommend|สเปก|spec|รุ่น|มีของ|in stock|ราคา)/],
];
const hit = rules.find(([, re]) => re.test(t));

return [{ json: { route: hit ? hit[0] : 'troubleshooter', routed_by: 'keywords', ai_tier: 0 } }];
