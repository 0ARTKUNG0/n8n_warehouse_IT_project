// Turns the PC-parts CSV files (CPUData.csv, GPUData.csv, ...) into pc_parts_inventory.xlsx:
// one "Inventory" tab in the Store Chat format, ready for Google Sheets (File → Import).
// Usage: node build_pc_parts_sheet.js <folder with the CSV files>
// Needs the "xlsx" package (npm install xlsx).
//
// - Only products that have a price are kept. Prices are US dollars, converted at USD_TO_THB.
// - stock_qty is SAMPLE data (about 1 in 10 products is sold out): replace it with your real stock.
// - The CSV files have no pictures, so image_url is empty.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const USD_TO_THB = 35;
const dir = process.argv[2];
if (!dir) throw new Error('Usage: node build_pc_parts_sheet.js <folder with the CSV files>');

const s = v => String(v ?? '').trim();
const yes = v => s(v).toLowerCase() === 'true';
const join = parts => parts.filter(Boolean).join(', ');

// file -> category, SKU prefix for rows without a part number, description and extra tags
const FILES = {
  'CPUData.csv': ['cpu', 'CPU', r => join([`${s(r.Cores)} cores / ${s(r.Threads)} threads`, `${s(r['Base Clock'])}${s(r['Turbo Clock']) ? `-${s(r['Turbo Clock'])}` : ''}`, `socket ${s(r.Socket)}`, s(r.TDP), yes(r['Integrated GPU']) && 'integrated graphics', yes(r['Unlocked Multiplier']) && 'unlocked']), r => [s(r.Socket)]],
  'GPUData.csv': ['gpu', 'GPU', r => join([s(r.Vram) && `${s(r.Vram)} VRAM`, s(r['Boost Clock']) && `boost ${s(r['Boost Clock'])}`, s(r.TDP), s(r.Length) && `length ${s(r.Length)}`, `${s(r.HDMI) || 0} HDMI / ${s(r.DisplayPort) || 0} DisplayPort`]), () => ['gaming']],
  'RAMData.csv': ['ram', 'RAM', r => join([s(r['Ram Type']), s(r.Size) && `${s(r.Size)}${s(r.Sticks) ? ` (${s(r.Sticks)} sticks)` : ''}`, s(r.Timings) && `timings ${s(r.Timings)}`]), r => [s(r['Ram Type']).split('-')[0]]],
  'SSDData.csv': ['ssd', 'SSD', r => join([s(r.Size), `${s(r['Form Factor'])} ${s(r.Protocol).replace(/^NVM$/, 'NVMe')}`.trim(), s(r.NAND)]), r => [/nvm/i.test(s(r.Protocol)) ? 'nvme' : 'sata']],
  'HDDData.csv': ['hdd', 'HDD', r => join([s(r.Size), s(r.RPM) && `${s(r.RPM)} RPM`, s(r['Form Factor']), s(r.Cache) && `cache ${s(r.Cache)}`]), () => []],
  'MotherboardData.csv': ['motherboard', 'MB', r => join([`socket ${s(r.Socket)}`, s(r.Chipset) && `chipset ${s(r.Chipset)}`, s(r['Form Factor']), s(r['Memory Type']) && `${s(r['Memory Type'])} up to ${s(r['Memory Capacity'])}`, s(r['RAM Slots']) && `${s(r['RAM Slots'])} RAM slots`, yes(r.WiFi) && 'WiFi']), r => [s(r.Socket), s(r['Memory Type']), yes(r.WiFi) && 'wifi']],
  'PSUData.csv': ['psu', 'PSU', r => join([s(r.Watt), s(r['Efficiency Rating']), s(r.Size)]), () => []],
  'CaseData.csv': ['case', 'CASE', r => join([s(r.Motherboard) && `for ${s(r.Motherboard)}`, s(r['Supported GPU Length']) && `GPU up to ${s(r['Supported GPU Length'])}`, s(r['Supported CPU Cooler Height']) && `CPU cooler up to ${s(r['Supported CPU Cooler Height'])}`, s(r['Primary Color(s)']) && `color ${s(r['Primary Color(s)'])}`, s(r.Window) && s(r.Window) !== 'False' && 'side window']), () => []],
  'CPUCoolerData.csv': ['cpu-cooler', 'COOL', r => join([s(r['Supported Sockets']) && `sockets ${s(r['Supported Sockets']).slice(0, 90)}`, s(r.Height) && `height ${s(r.Height)}`, s(r.TDP) && `for CPUs up to ${s(r.TDP)}`]), () => []],
  'MonitorData.csv': ['monitor', 'MON', r => join([s(r.Size), s(r.Resolution), s(r['Refresh Rate']), s(r.Panel), s(r['Response Time']) && `${s(r['Response Time'])} ms`, yes(r.Curved) && 'curved', s(r.Sync)]), r => [parseInt(s(r['Refresh Rate']), 10) >= 144 && 'gaming']],
};

const rows = [];
const seen = new Set();
for (const [file, [category, prefix, describe, extraTags]] of Object.entries(FILES)) {
  const sheet = XLSX.readFile(path.join(dir, file), { raw: true }).Sheets.Sheet1;
  let n = 0;
  for (const r of XLSX.utils.sheet_to_json(sheet, { defval: '' })) {
    const usd = Number(s(r.Price).replace(/[^0-9.]/g, ''));
    if (!s(r.Price) || !Number.isFinite(usd) || usd <= 0 || !s(r.Name)) continue;
    n += 1;
    let sku = s(r.MPN).toUpperCase();
    if (!sku || seen.has(sku)) sku = `${prefix}-${String(n).padStart(4, '0')}`;
    seen.add(sku);
    const h = parseInt(crypto.createHash('md5').update(sku).digest('hex').slice(0, 8), 16);
    rows.push({
      sku,
      name: s(r.Name),
      category,
      price_ex_vat: Math.round(usd * USD_TO_THB),
      stock_qty: h % 10 === 0 ? 0 : (h % 25) + 1,  // SAMPLE stock
      image_url: '',
      description: `${s(r.Producer)}. ${describe(r)}`.slice(0, 250),
      tags: [category, s(r.Producer).toLowerCase(), ...extraTags(r)].filter(Boolean).map(t => String(t).toLowerCase()).join(','),
    });
  }
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: ['sku', 'name', 'category', 'price_ex_vat', 'stock_qty', 'image_url', 'description', 'tags'] }), 'Inventory');
const out = path.join(__dirname, 'pc_parts_inventory.xlsx');
XLSX.writeFile(wb, out);
const count = c => rows.filter(r => r.category === c).length;
console.log(`${out}: ${rows.length} products (${Object.values(FILES).map(([c]) => `${c} ${count(c)}`).join(', ')}), ${rows.filter(r => r.stock_qty === 0).length} sold out`);
