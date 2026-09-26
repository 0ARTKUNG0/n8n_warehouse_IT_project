// Use the Troubleshooter's answer, or basic checks plus the staff contact if the AI is unavailable.
const c = $('Build Context').first(0).json;
const res = $input.first()?.json ?? {};
const th = c.lang !== 'en';

const out = res.ok === true && res.data && typeof res.data.reply === 'string' && res.data.reply.trim() ? res.data : null;
if (out) {
  return [{ json: {
    agent: 'troubleshooter', reply: out.reply.trim(), products: [], needs_human: out.needs_human === true,
    next_stage: '', degraded: false, ai_tier: res.tier ?? 0,
  } }];
}

const reply = th
  ? `ขออภัยครับ ตอนนี้ระบบผู้ช่วยขัดข้องชั่วคราว ลองตรวจสอบเบื้องต้นดังนี้ครับ\n1) ถอดแล้วเสียบสายหรือตัวรับสัญญาณใหม่ หรือลองพอร์ต USB อื่น\n2) ตรวจแบตเตอรี่หรือชาร์จให้เต็ม\n3) รีสตาร์ทคอมพิวเตอร์\nหากยังไม่หาย หรือเป็นเรื่องคำสั่งซื้อหรือการรับประกัน ติดต่อพนักงานได้ที่ ${c.store.store_contact}`
  : `Sorry, our assistant is having a temporary problem. Quick checks:\n1) Unplug and reconnect the cable or receiver, or try another USB port\n2) Check or charge the battery\n3) Restart the computer\nIf that doesn't help, or it's about an order or warranty, contact our staff: ${c.store.store_contact}`;

return [{ json: {
  agent: 'troubleshooter', reply, products: [], needs_human: true, next_stage: '', degraded: true, ai_tier: 0,
} }];
