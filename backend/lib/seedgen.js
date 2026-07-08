'use strict';

// Deterministic generator for the bundled demo dataset "meesho_orders.csv".
// Planted patterns (all discoverable by DataScope):
//  - mixed date formats (ISO + DD/MM/YYYY + DD-MM-YY)
//  - a few "test" rows and one future date
//  - one extreme-price outlier
//  - QuickShip courier with a clearly higher return rate (chi-square demo)
//  - Karnataka AOV > Maharashtra AOV (t-test demo)
//  - a handful of duplicate rows and scattered nulls

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATES = ['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Uttar Pradesh', 'West Bengal', 'Gujarat'];
const CATEGORIES = ['Sarees', 'Kurtis', 'Footwear', 'Home Decor', 'Jewellery', 'Kids Wear'];
const COURIERS = ['ValueExpress', 'QuickShip', 'BlueDart Lite', 'EcomPost'];
const REASONS = ['size issue', 'quality not as expected', 'wrong item', 'damaged in transit', 'changed mind'];

function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

function fmtDate(rnd, y, m, d) {
  const mm = String(m).padStart(2, '0'), dd = String(d).padStart(2, '0');
  const roll = rnd();
  if (roll < 0.6) return `${y}-${mm}-${dd}`;              // ISO
  if (roll < 0.85) return `${dd}/${mm}/${y}`;             // DD/MM/YYYY
  return `${dd}-${mm}-${String(y).slice(2)}`;             // DD-MM-YY
}

function generateSeedCSV() {
  const rnd = mulberry32(20260708);
  const lines = ['order_id,order_date,state,category,courier,price,shipping_fee,qty,returned,return_reason'];
  const rows = [];

  for (let i = 1; i <= 500; i++) {
    const state = pick(rnd, STATES);
    const category = pick(rnd, CATEGORIES);
    const courier = pick(rnd, COURIERS);
    const m = 1 + Math.floor(rnd() * 6); // Jan–Jun 2026
    const d = 1 + Math.floor(rnd() * 28);
    const date = fmtDate(rnd, 2026, m, d);

    // Base price by category, plus planted Karnataka premium (t-test demo)
    let price = 250 + rnd() * 600;
    if (category === 'Jewellery') price += 150;
    if (state === 'Karnataka') price += 180;          // planted AOV difference
    if (state === 'Maharashtra') price -= 40;
    price = Math.round(price);

    const qty = rnd() < 0.8 ? 1 : 1 + Math.floor(rnd() * 3);

    // shipping_fee tracks price (correlation/scatter demo, r ≈ 0.8)
    const fee = Math.round(35 + price * 0.09 + rnd() * 25);

    // Planted courier effect: QuickShip returns ~35%, others ~12%
    const returnP = courier === 'QuickShip' ? 0.35 : 0.12;
    const returned = rnd() < returnP ? 'yes' : 'no';
    const reason = returned === 'yes' ? pick(rnd, REASONS) : '';

    // Scattered nulls (~2% of states missing)
    const stateOut = rnd() < 0.02 ? '' : state;

    rows.push([`ORD${String(10000 + i)}`, date, stateOut, category, courier, String(price), String(fee), String(qty), returned, reason]);
  }

  // Planted anomalies
  rows[47][5] = '49999';                                  // extreme price outlier
  rows[120] = ['ORD10121', '2026-03-15', 'test', 'test', 'test', '1', '1', '1', 'no', ''];
  rows[121] = ['ORD10122', '2026-03-15', 'asdf', 'asdf', 'asdf', '0', '1', '1', 'no', ''];
  rows[200][1] = '2031-01-01';                            // future date
  rows[310] = [...rows[309]];                             // duplicates
  rows[311] = [...rows[309]];
  rows[400][5] = 'error';                                 // non-numeric noise in price
  rows[401][5] = 'error';

  for (const r of rows) {
    lines.push(r.map((c) => (c.includes(',') || c.includes('"') ? `"${c.replace(/"/g, '""')}"` : c)).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { generateSeedCSV };
