/* Refinery calculation engine — replicates REFINERY_COMPARISON.xlsx sheet by sheet.
 *
 * Units used inside the engine (same as the Excel file):
 *   assays Au/Ag/Pd/Pt in g/t (g/dmt), Cu/Al/Cr/Ni/As as FRACTIONS (0.1564 = 15.64 %),
 *   Hg in ppm, moisture as a fraction, weights in kg.
 *   prices: precious metals USD per gram, copper USD per kg; fx = USD per 1 EUR.
 */
(function (root) {
  "use strict";

  const TOZ = 31.1034768;       // g per troy ounce
  const KG_PER_MT = 1000;
  const LB_PER_KG = 2.20462;    // as used in the Excel file (METAL_PRICES!B31)

  const n = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  // XLOOKUP(x, from, value, 0, -1): exact match or next smaller
  function bracket(rows, x) {
    let out = 0;
    for (const [from, val] of rows) if (x >= from) out = val;
    return out;
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---------------------------------------------------------------- ASAHI
  const ASAHI = {
    id: "asahi", name: "Asahi", currency: "USD",
    paid: ["au", "ag", "pd", "cu"],
    benchmarks: { au: "LBMA AM&PM monthly avg", ag: "LBMA monthly avg", pd: "LBMA AM&PM monthly avg", cu: "LME settlement monthly avg" },
    notes: [
      "Payable = assay × recovery from the bracket table (straight recovery). No payment below the lowest tier.",
      "Treatment is charged on the received NET (wet) weight.",
      "Boundary: FROM is an inclusive lower bound — exactly 10 g/t Au gets 50 %. Confirm with Asahi.",
      "Metals paid: Au, Ag, Pd, Cu only — no platinum in this offer. No Cu refining charge quoted.",
      "Contractual minimum lot weight 500 kg (not a charge).",
    ],
    defaults: {
      tc: 0.7, lotCharge: 100, rcAu: 0.35, rcPd: 1.0, rcAg: 0.04, rcCu: 0, minLotKg: 500,
      au_factor: 0.99, ag_factor: 1, pd_factor: 0.97, cu_factor: 0.95,
      auBr: [[0, 0], [10, 0.5], [50, 0.9], [100, 0.98], [500, 0.985], [3000, 0.99]],
      agBr: [[0, 0], [100, 0.65], [300, 0.8], [500, 0.85], [1000, 0.9], [4000, 0.95]],
      pdBr: [[0, 0], [10, 0.3], [30, 0.5], [100, 0.8], [300, 0.88]],
      cuBr: [[0, 0], [0.1, 0.65], [0.2, 0.75]],
    },
    schema: [
      { title: "Commercial terms", fields: [
        ["tc", "Treatment charge", "USD/kg", "num", "received net (wet) weight"],
        ["lotCharge", "Lot charge", "USD/lot", "num", "flat per lot"],
        ["rcAu", "Au refining charge", "USD/g", "num", "on payable gold"],
        ["rcPd", "Pd refining charge", "USD/g", "num", "on payable palladium"],
        ["rcAg", "Ag refining charge", "USD/g", "num", "on payable silver"],
        ["rcCu", "Cu refining charge", "USD/kg", "num", "none quoted in this offer"],
        ["minLotKg", "Minimum lot weight", "kg", "num", "contractual minimum — not a charge"],
      ]},
      { title: "Price factor", metals: ["au", "ag", "pd", "cu"], cols: [["factor", "Price factor", "%", "pct"]] },
      { title: "Recovery brackets (from → recovery)", brackets: [
        ["auBr", "Au", "g/t", "num"], ["agBr", "Ag", "g/t", "num"], ["pdBr", "Pd", "g/t", "num"], ["cuBr", "Cu", "%", "pct"],
      ]},
    ],
    calc(L, P, fx, T) {
      const rec = { au: bracket(T.auBr, L.au), ag: bracket(T.agBr, L.ag), pd: bracket(T.pdBr, L.pd), cu: bracket(T.cuBr, L.cu) };
      const metals = {};
      ["au", "ag", "pd", "cu"].forEach((m) => {
        const payGrade = L[m] * rec[m];
        const qty = m === "cu" ? payGrade * L.dryKg : payGrade * L.dmt;   // g ; Cu kg
        const price = P[m] * T[m + "_factor"];
        metals[m] = { payGrade, qty, qtyUnit: m === "cu" ? "kg" : "g", price, priceUnit: m === "cu" ? "USD/kg" : "USD/g", value: qty * price, rule: `recovery ${pct(rec[m])}` };
      });
      const charges = [
        ch("Treatment charge", T.tc * L.grossKg, `${T.tc} USD/kg × ${fmt(L.grossKg)} kg wet`),
        ch("Lot charge", T.lotCharge, "flat"),
        ch("Au refining charge", metals.au.qty * T.rcAu, `${T.rcAu} USD/g payable`),
        ch("Ag refining charge", metals.ag.qty * T.rcAg, `${T.rcAg} USD/g payable`),
        ch("Pd refining charge", metals.pd.qty * T.rcPd, `${T.rcPd} USD/g payable`),
        ch("Cu refining charge", metals.cu.qty * T.rcCu, T.rcCu ? `${T.rcCu} USD/kg payable` : "none quoted"),
      ];
      const warnings = [];
      if (L.grossKg < T.minLotKg) warnings.push(`Below ${fmt(T.minLotKg)} kg minimum lot`);
      if (L.pt > 0) warnings.push("Platinum is not paid");
      return finish(this, L, P, fx, metals, charges, { warnings });
    },
  };

  // ---------------------------------------------------------------- DOWA
  const DOWA = {
    id: "dowa", name: "Dowa", currency: "USD",
    paid: ["au", "ag", "pt", "pd", "cu"],
    benchmarks: { au: "LBMA/LME 100 % (assumed)", ag: "LBMA (assumed)", pt: "LBMA/LPPM", pd: "LBMA (assumed)", cu: "LME (assumed)" },
    notes: [
      "Tiers: 'UP TO' is an inclusive upper bound. In a DEDUCT tier payable = assay − value; in a RECOVERY tier payable = assay × value.",
      "Price basis assumed LBMA/LME at 100 % participation — no price-basis clause in the appendix, confirm with Dowa.",
      "Cu: flat deduction of 3.0 units (percentage points); Cu refining charge in USD/lb on payable copper.",
      "Refining charges on payable metal. Charges on dry weight (dmt).",
      "Quality minimum: Au 50 g/DMT (clause 2).",
      "Only refinery in the file that pays platinum.",
    ],
    defaults: {
      tc: 850, sampling: 1000, shred: 60, shredMm: 20,
      rcAu: 7, rcAg: 0.65, rcPt: 25, rcPd: 20, rcCu: 0.35, cuDed: 0.03, auMin: 50,
      provUsed: "NO", provPct: 0.5, finRate: 0, finDays: 0,
      au_part: 1, ag_part: 1, pt_part: 1, pd_part: 1, cu_part: 1,
      auTiers: [[100, "DEDUCT", 10], [190, "RECOVERY", 0.95], [500, "RECOVERY", 0.96], [1000, "RECOVERY", 0.97], ["ABOVE", "RECOVERY", 0.975]],
      agTiers: [[2000, "DEDUCT", 100], [3000, "RECOVERY", 0.95], ["ABOVE", "RECOVERY", 0.96]],
      ptTiers: [[75, "DEDUCT", 15], [85, "RECOVERY", 0.8], [1000, "RECOVERY", 0.85], ["ABOVE", "RECOVERY", 0.88]],
      pdTiers: [[67, "DEDUCT", 10], [300, "RECOVERY", 0.85], [500, "RECOVERY", 0.88], ["ABOVE", "RECOVERY", 0.9]],
    },
    schema: [
      { title: "Commercial terms", fields: [
        ["tc", "Treatment charge", "USD/dmt", "num", "all material"],
        ["sampling", "Sampling charge", "USD/lot", "num", "flat per lot"],
        ["shred", "Shredding charge", "USD/dmt", "num", "material exceeding the threshold"],
        ["shredMm", "Shredding threshold", "mm", "num", "20 × 20 mm"],
        ["rcAu", "Au refining charge", "USD/toz", "num", "on payable gold"],
        ["rcAg", "Ag refining charge", "USD/toz", "num", "on payable silver"],
        ["rcPt", "Pt refining charge", "USD/toz", "num", "on payable platinum"],
        ["rcPd", "Pd refining charge", "USD/toz", "num", "on payable palladium"],
        ["rcCu", "Cu refining charge", "USD/lb", "num", "on payable copper"],
        ["cuDed", "Cu flat deduction", "% points", "pct", "less 3.0 units"],
        ["auMin", "Quality minimum Au", "g/DMT", "num", "contractual minimum"],
      ]},
      { title: "Provisional payment / finance", fields: [
        ["provUsed", "Provisional payment used?", "", "sel:YES,NO", ""],
        ["provPct", "Provisional payment", "%", "pct", "of estimated purchase price"],
        ["finRate", "Finance rate (SOFR + spread)", "% / year", "pct", "current SOFR + 2.0 %"],
        ["finDays", "Finance days", "days", "num", "provisional payment → assay finalisation"],
      ]},
      { title: "Price participation", metals: ["au", "ag", "pt", "pd", "cu"], cols: [["part", "Participation", "%", "pct"]] },
      { title: "Payable tiers (up to → mode → value)", tiers: [["auTiers", "Au"], ["agTiers", "Ag"], ["ptTiers", "Pt"], ["pdTiers", "Pd"]] },
    ],
    calc(L, P, fx, T) {
      const tierPay = (tiers, a) => {
        for (const [upTo, mode, v] of tiers) {
          if (upTo === "ABOVE" || a <= upTo) return mode === "DEDUCT" ? { g: Math.max(0, a - v), r: `−${v} g/t` } : { g: a * v, r: `recovery ${pct(v)}` };
        }
        return { g: 0, r: "" };
      };
      const metals = {};
      ["au", "ag", "pt", "pd"].forEach((m) => {
        const t = tierPay(T[m + "Tiers"], L[m]);
        const qty = t.g * L.dmt;
        const price = P[m] * T[m + "_part"];
        metals[m] = { payGrade: t.g, qty, qtyUnit: "g", price, priceUnit: "USD/g", value: qty * price, rule: t.r };
      });
      const cuG = Math.max(0, L.cu - T.cuDed);
      const cuQ = cuG * L.dryKg;
      metals.cu = { payGrade: cuG, qty: cuQ, qtyUnit: "kg", price: P.cu * T.cu_part, priceUnit: "USD/kg", value: cuQ * P.cu * T.cu_part, rule: `−${pct(T.cuDed)} points` };
      const gross = sumVal(metals);
      const shredOn = L.pieceMm > T.shredMm;
      const charges = [
        ch("Treatment charge", T.tc * L.dmt, `${T.tc} USD/dmt`),
        ch("Sampling charge", T.sampling, "flat per lot"),
        ch("Shredding charge", shredOn ? T.shred * L.dmt : 0, shredOn ? `pieces > ${T.shredMm} mm` : `pieces ≤ ${T.shredMm} mm — not charged`),
        ch("Au refining charge", metals.au.qty / TOZ * T.rcAu, `${T.rcAu} USD/toz payable`),
        ch("Ag refining charge", metals.ag.qty / TOZ * T.rcAg, `${T.rcAg} USD/toz payable`),
        ch("Pt refining charge", metals.pt.qty / TOZ * T.rcPt, `${T.rcPt} USD/toz payable`),
        ch("Pd refining charge", metals.pd.qty / TOZ * T.rcPd, `${T.rcPd} USD/toz payable`),
        ch("Cu refining charge", cuQ * LB_PER_KG * T.rcCu, `${T.rcCu} USD/lb payable`),
        ch("Finance charge", T.provUsed === "YES" ? gross * T.provPct * T.finRate * T.finDays / 360 : 0, T.provUsed === "YES" ? "provisional payment financing" : "provisional payment not used"),
      ];
      const warnings = [];
      if (L.au < T.auMin) warnings.push(`Au below ${T.auMin} g/DMT contract minimum (clause 2)`);
      return finish(this, L, P, fx, metals, charges, { warnings });
    },
  };

  // ---------------------------------------------------------------- PEDALPOINT
  const PEDALPOINT = {
    id: "pedalpoint", name: "PedalPoint", currency: "USD",
    paid: ["au", "ag", "pd", "cu"],
    benchmarks: { au: "London AM/PM fix avg", ag: "London spot avg", pd: "London Pd AM/PM fix avg", cu: "Lowest of LME cash or 3-month" },
    notes: [
      "Payable = assay − MAX(assay × (1 − bracket %), minimum deduction)  (greater-of rule).",
      "Treatment and sampling are quoted in EUR/dmt and converted to USD with the EUR/USD rate.",
      "Zero-value floor (clause 13): if payables − T/C − sampling < 0 the lot is worth zero.",
      "No Ag or Pd refining charge quoted in the agreement. No platinum paid.",
    ],
    defaults: {
      tc: 320, sampling: 50, rcAu: 15, rcCu: 0.3, rcAg: 0, rcPd: 0,
      auMin: 6.5, pdMin: 6, agMin: 0, cuMin: 0,
      floor: "YES", floorBasis: "LITERAL", rcBase: "PAYABLE",
      au_factor: 1, ag_factor: 1, pd_factor: 1, cu_factor: 1,
      auBr: [[0, 0], [10, 0.72], [25, 0.78], [40, 0.82], [50, 0.86], [70, 0.88], [90, 0.89], [100, 0.9]],
      agBr: [[0, 0], [200, 0.6], [300, 0.78], [500, 0.85], [1000, 0.88]],
      pdBr: [[0, 0], [10, 0.65], [15, 0.75]],
      cuBr: [[0, 0], [0.1, 0.8], [0.15, 0.85]],
    },
    schema: [
      { title: "Commercial terms", fields: [
        ["tc", "Treatment charge", "EUR/dmt", "num", "all material"],
        ["sampling", "Sampling charge", "EUR/dmt", "num", "all material"],
        ["rcAu", "Au refining charge", "USD/toz", "num", "on payable gold"],
        ["rcCu", "Cu refining charge", "USD/kg", "num", "on payable copper"],
        ["rcAg", "Ag refining charge", "USD/g", "num", "none quoted"],
        ["rcPd", "Pd refining charge", "USD/g", "num", "none quoted"],
        ["auMin", "Au minimum deduction", "g/MT", "num", "clause 7"],
        ["pdMin", "Pd minimum deduction", "g/MT", "num", "clause 7"],
        ["agMin", "Ag minimum deduction", "g/MT", "num", "none quoted"],
        ["cuMin", "Cu minimum deduction", "% points", "pct", "none quoted"],
        ["floor", "Zero-value floor active?", "", "sel:YES,NO", "clause 13"],
        ["floorBasis", "Floor basis", "", "sel:LITERAL,ALL", "LITERAL = payables − T/C − sampling only"],
        ["rcBase", "R/C applies to", "", "sel:PAYABLE,CONTAINED", ""],
      ]},
      { title: "Price factor", metals: ["au", "ag", "pd", "cu"], cols: [["factor", "Price factor", "%", "pct"]] },
      { title: "Payable brackets (from → payable %)", brackets: [
        ["auBr", "Au", "g/t", "num"], ["agBr", "Ag", "g/t", "num"], ["pdBr", "Pd", "g/t", "num"], ["cuBr", "Cu", "%", "pct"],
      ]},
    ],
    calc(L, P, fx, T) {
      const metals = {};
      const mins = { au: T.auMin, ag: T.agMin, pd: T.pdMin, cu: T.cuMin };
      ["au", "ag", "pd", "cu"].forEach((m) => {
        const p = bracket(T[m + "Br"], L[m]);
        const ded = Math.max(L[m] * (1 - p), mins[m]);
        const g = Math.max(0, L[m] - ded);
        const qty = m === "cu" ? g * L.dryKg : g * L.dmt;
        const price = P[m] * T[m + "_factor"];
        metals[m] = { payGrade: g, qty, qtyUnit: m === "cu" ? "kg" : "g", price, priceUnit: m === "cu" ? "USD/kg" : "USD/g", value: qty * price, rule: `${pct(p)} payable, min ded. ${m === "cu" ? pct(mins[m]) : mins[m] + " g/t"}`, contained: m === "cu" ? L[m] * L.dryKg : L[m] * L.dmt };
      });
      const base = (m) => (T.rcBase === "CONTAINED" ? metals[m].contained : metals[m].qty);
      const tcUsd = T.tc * L.dmt * fx, smpUsd = T.sampling * L.dmt * fx;
      const charges = [
        ch("Treatment charge", tcUsd, `${T.tc} EUR/dmt × FX`),
        ch("Sampling charge", smpUsd, `${T.sampling} EUR/dmt × FX`),
        ch("Au refining charge", base("au") / TOZ * T.rcAu, `${T.rcAu} USD/toz ${T.rcBase.toLowerCase()}`),
        ch("Cu refining charge", base("cu") * T.rcCu, `${T.rcCu} USD/kg ${T.rcBase.toLowerCase()}`),
        ch("Ag refining charge", base("ag") * T.rcAg, T.rcAg ? `${T.rcAg} USD/g` : "none quoted"),
        ch("Pd refining charge", base("pd") * T.rcPd, T.rcPd ? `${T.rcPd} USD/g` : "none quoted"),
      ];
      const gross = sumVal(metals);
      const total = charges.reduce((s, c) => s + c.amount, 0);
      const test = T.floorBasis === "ALL" ? gross - total : gross - tcUsd - smpUsd;
      const floorHit = T.floor === "YES" && test < 0;
      const warnings = [];
      if (floorHit) warnings.push("Zero-value floor triggered — lot settles at 0");
      if (L.pt > 0) warnings.push("Platinum is not paid");
      return finish(this, L, P, fx, metals, charges, { warnings, forceNet: floorHit ? 0 : null });
    },
  };

  // ---------------------------------------------------------------- HANWA
  const HANWA = {
    id: "hanwa", name: "Hanwa", currency: "USD",
    paid: ["au", "ag", "pd", "cu"],
    benchmarks: { au: "LBMA AM/PM average", ag: "LBMA", pd: "LBMA PM", cu: "LME Grade A monthly avg" },
    notes: [
      "Payable = contained × recovery from the bracket table.",
      "Low-grade extra per lot is charged for every metal whose assay is below its limit (including an assay of 0).",
      "Small-lot surcharge for lots under 1 dmt, except CPU / RAM / IC chip / memory.",
      "Al and Cr penalties per step above threshold, on dry weight (proportional or rounded up).",
      "No platinum paid.",
    ],
    defaults: {
      tc: 650, crush: 200, crushMm: 50, smallLot: 170, smallLotDmt: 1,
      alRate: 6, alThr: 0.06, alStep: 0.001, crRate: 15, crThr: 0.005, crStep: 0.001,
      rcBase: "PAYABLE", impMode: "PROPORTIONAL",
      au_factor: 0.98, ag_factor: 1, pd_factor: 0.95, cu_factor: 1,
      au_rc: 0.9, ag_rc: 0.06, pd_rc: 2.5, cu_rc: 0.5,
      au_lim: 10, ag_lim: 300, pd_lim: 20, cu_lim: 0.1,
      au_extra: 80, ag_extra: 80, pd_extra: 80, cu_extra: 50,
      auBr: [[0, 0], [10, 0.85], [30, 0.9], [50, 0.94], [100, 0.96], [300, 0.97]],
      agBr: [[0, 0], [300, 0.5], [500, 0.9], [5000, 0.95]],
      pdBr: [[0, 0], [20, 0.8], [100, 0.85]],
      cuBr: [[0, 0], [0.1, 0.9]],
    },
    schema: [
      { title: "Commercial terms", fields: [
        ["tc", "Treatment charge (T/C)", "USD/dmt", "num", "all material"],
        ["crush", "Crushing charge", "USD/dmt", "num", "material exceeding the threshold"],
        ["crushMm", "Crushing threshold", "mm", "num", "50 × 50 mm"],
        ["smallLot", "Small-lot surcharge", "USD/lot", "num", "not CPU/RAM/IC chip/memory"],
        ["smallLotDmt", "Small-lot threshold", "dmt", "num", "strictly less than"],
        ["alRate", "Al penalty rate", "USD/dmt per step", "num", ""],
        ["alThr", "Al penalty threshold", "%", "pct", ""],
        ["alStep", "Al penalty step", "%", "pct", ""],
        ["crRate", "Cr penalty rate", "USD/dmt per step", "num", ""],
        ["crThr", "Cr penalty threshold", "%", "pct", ""],
        ["crStep", "Cr penalty step", "%", "pct", ""],
        ["rcBase", "R/C applies to", "", "sel:PAYABLE,CONTAINED", ""],
        ["impMode", "Impurity increments", "", "sel:PROPORTIONAL,ROUNDUP", ""],
      ]},
      { title: "Metal terms", metals: ["au", "ag", "pd", "cu"], cols: [
        ["factor", "Price factor", "%", "pct"], ["rc", "Refining charge", "USD/g · Cu USD/kg", "num"],
        ["lim", "Low-grade limit", "g/t · Cu %", "auto"], ["extra", "Low-grade extra", "USD/lot", "num"],
      ]},
      { title: "Recovery brackets (from → recovery)", brackets: [
        ["auBr", "Au", "g/t", "num"], ["agBr", "Ag", "g/t", "num"], ["pdBr", "Pd", "g/t", "num"], ["cuBr", "Cu", "%", "pct"],
      ]},
    ],
    calc(L, P, fx, T) {
      const metals = {};
      ["au", "ag", "pd", "cu"].forEach((m) => {
        const r = bracket(T[m + "Br"], L[m]);
        const contained = m === "cu" ? L[m] * L.dryKg : L[m] * L.dmt;
        const qty = contained * r;
        const price = P[m] * T[m + "_factor"];
        metals[m] = { payGrade: L[m] * r, qty, contained, qtyUnit: m === "cu" ? "kg" : "g", price, priceUnit: m === "cu" ? "USD/kg" : "USD/g", value: qty * price, rule: `recovery ${pct(r)}` };
      });
      const base = (m) => (T.rcBase === "CONTAINED" ? metals[m].contained : metals[m].qty);
      const steps = (v, thr, step) => { const s = Math.max(0, (v - thr) / step); return T.impMode === "ROUNDUP" ? Math.ceil(s) : s; };
      const crushOn = L.pieceMm > T.crushMm;
      const smallOn = L.dmt < T.smallLotDmt && !L.exempt;
      const charges = [
        ch("Treatment charge", T.tc * L.dmt, `${T.tc} USD/dmt`),
        ch("Crushing charge", crushOn ? T.crush * L.dmt : 0, crushOn ? `pieces > ${T.crushMm} mm` : `pieces ≤ ${T.crushMm} mm — not charged`),
        ch("Small-lot surcharge", smallOn ? T.smallLot : 0, smallOn ? `lot under ${T.smallLotDmt} dmt` : L.exempt && L.dmt < T.smallLotDmt ? "exempt item" : "not applicable"),
      ];
      ["au", "ag", "pd", "cu"].forEach((m) => {
        const on = L[m] < T[m + "_lim"];
        charges.push(ch(`${M[m]} low-grade extra`, on ? T[m + "_extra"] : 0, on ? `assay below ${m === "cu" ? pct(T[m + "_lim"]) : T[m + "_lim"] + " g/t"}` : "not applicable"));
      });
      ["au", "ag", "pd", "cu"].forEach((m) => charges.push(ch(`${M[m]} refining charge`, base(m) * T[m + "_rc"], `${T[m + "_rc"]} USD/${m === "cu" ? "kg" : "g"} ${T.rcBase.toLowerCase()}`)));
      charges.push(ch("Al impurity penalty", steps(L.al, T.alThr, T.alStep) * T.alRate * L.dmt, L.al > T.alThr ? `Al above ${pct(T.alThr)}` : "not applicable"));
      charges.push(ch("Cr impurity penalty", steps(L.cr, T.crThr, T.crStep) * T.crRate * L.dmt, L.cr > T.crThr ? `Cr above ${pct(T.crThr)}` : "not applicable"));
      const warnings = [];
      if (L.pt > 0) warnings.push("Platinum is not paid");
      return finish(this, L, P, fx, metals, charges, { warnings });
    },
  };

  // ---------------------------------------------------------------- UMICORE
  const UMICORE = {
    id: "umicore", name: "Umicore", currency: "EUR",
    paid: ["au", "ag", "pd", "cu"],
    benchmarks: { au: "LBMA AM", ag: "LBMA", pd: "LBMA AM", cu: "LME Grade A — lowest of four official" },
    notes: [
      "Payable = assay − MAX(assay × (1 − payable %), minimum deduction).",
      "Prices: (USD/toz × price factor − adjustment) converted to EUR/g with the EUR/USD rate.",
      "Sampling fee per sampled lot; every € 1,000,000 of metal value counts as one more sampled lot.",
      "Hedging charge = gross metal value × lease rate × days / day-count.",
      "Green Auto Recycling trader layer: commission per dmt is deducted from the refiner net (trader is between you and Umicore).",
      "No platinum paid.",
    ],
    defaults: {
      tc: 550, shred: 75, shredMm: 40, sampling: 1250, sampleCap: 1000000, smallLot: 1000, smallLotDmt: 10,
      niRate: 3.75, niThr: 0.001, niStep: 0.001,
      au_pay: 0.96, ag_pay: 0.95, pd_pay: 0.92, cu_pay: 1,
      au_min: 5, ag_min: 100, pd_min: 15, cu_min: 0.03,
      au_rc: 150, ag_rc: 15, pd_rc: 550, cu_rc: 0.9,
      au_factor: 0.99, ag_factor: 0.99, pd_factor: 0.99, cu_factor: 0.99,
      au_adj: 0, ag_adj: 0, pd_adj: 3, cu_adj: 0,
      lease: 0.03, hedgeDays: 120, dayCount: 360, hedge: "YES",
      trader: "YES", commission: 500, commBasis: "DRY", cash: 0, cashFee: 0.04, cashFeeIncl: "NO", advance: 0.8,
    },
    schema: [
      { title: "Commercial terms", fields: [
        ["tc", "Basic treatment charge", "EUR/dmt", "num", "all material"],
        ["shred", "Shredding charge", "EUR/dmt", "num", "pieces over the threshold"],
        ["shredMm", "Shredding threshold", "mm", "num", "4 cm"],
        ["sampling", "Sampling fee", "EUR/sampled lot", "num", "per lot up to the value cap"],
        ["sampleCap", "Sampling lot value cap", "EUR", "num", "value above this = extra sampled lot"],
        ["smallLot", "Small-lot additional cost", "EUR/lot", "num", "lot under the threshold"],
        ["smallLotDmt", "Small-lot threshold", "dmt", "num", "strictly less than"],
        ["niRate", "Ni penalty rate", "EUR/dmt per step", "num", ""],
        ["niThr", "Ni penalty threshold", "%", "pct", ""],
        ["niStep", "Ni penalty step", "%", "pct", ""],
      ]},
      { title: "Metal terms", metals: ["au", "ag", "pd", "cu"], cols: [
        ["pay", "Payable", "%", "pct"], ["min", "Min. deduction", "g/dmt · Cu %", "auto"],
        ["rc", "R/C", "EUR/kg", "num"], ["factor", "Price factor", "%", "pct"], ["adj", "Price adj.", "USD/toz · Cu USD/MT", "num"],
      ]},
      { title: "Hedging / financing", fields: [
        ["hedge", "Apply hedging charge?", "", "sel:YES,NO", ""],
        ["lease", "Lease rate", "% / year", "pct", "contract floor — not lower than 3 %"],
        ["hedgeDays", "Due date for purchase", "days", "num", "after arrival of last truck"],
        ["dayCount", "Day-count basis", "days", "num", "360 or 365"],
      ]},
      { title: "Green Auto Recycling (trader layer)", fields: [
        ["trader", "Deduct trader commission?", "", "sel:YES,NO", "the Excel deducts it"],
        ["commission", "Trader commission", "EUR/dmt", "num", "fixed discount from the refiner price"],
        ["commBasis", "Commission basis", "", "sel:DRY,WET", "confirm which applies"],
        ["cash", "Cash portion requested", "EUR", "num", "amount taken in cash"],
        ["cashFee", "Cash handling fee", "%", "pct", "of the cash portion"],
        ["cashFeeIncl", "Include cash fee in comparison?", "", "sel:YES,NO", ""],
        ["advance", "Advance payment", "%", "pct", "of the estimation value"],
      ]},
    ],
    calc(L, P, fx, T) {
      const metals = {};
      ["au", "ag", "pd", "cu"].forEach((m) => {
        const ded = Math.max(L[m] * (1 - T[m + "_pay"]), T[m + "_min"]);
        const g = Math.max(0, L[m] - ded);
        const qty = m === "cu" ? g * L.dryKg : g * L.dmt;          // g ; Cu kg
        // EUR price: (USD/toz × factor − adj) / toz / fx  — Cu: (USD/MT × factor − adj) / 1000 / fx
        const price = m === "cu"
          ? (P.cu * KG_PER_MT * T.cu_factor - T.cu_adj) / KG_PER_MT / fx
          : (P[m] * TOZ * T[m + "_factor"] - T[m + "_adj"]) / TOZ / fx;
        metals[m] = { payGrade: g, qty, qtyUnit: m === "cu" ? "kg" : "g", price, priceUnit: m === "cu" ? "EUR/kg" : "EUR/g", value: qty * price, rule: `${pct(T[m + "_pay"])} payable, min ded. ${m === "cu" ? pct(T[m + "_min"]) : T[m + "_min"] + " g/t"}` };
      });
      const gross = sumVal(metals);
      const shredOn = L.pieceMm > T.shredMm;
      const lots = Math.max(1, Math.ceil(gross / T.sampleCap));
      const smallOn = L.dmt < T.smallLotDmt;
      const kgPay = (m) => (m === "cu" ? metals.cu.qty : metals[m].qty / 1000);
      const charges = [
        ch("Basic treatment charge", T.tc * L.dmt, `${T.tc} EUR/dmt`),
        ch("Shredding charge", shredOn ? T.shred * L.dmt : 0, shredOn ? `pieces > ${T.shredMm} mm` : `pieces ≤ ${T.shredMm} mm — not charged`),
        ch("Sampling fee", T.sampling * lots, `${lots} sampled lot${lots > 1 ? "s" : ""}`),
        ch("Small-lot additional cost", smallOn ? T.smallLot : 0, smallOn ? `lot under ${T.smallLotDmt} dmt` : "not applicable"),
      ];
      ["au", "ag", "pd", "cu"].forEach((m) => charges.push(ch(`${M[m]} refining charge`, kgPay(m) * T[m + "_rc"], `${T[m + "_rc"]} EUR/kg payable`)));
      charges.push(ch("Ni penalty", Math.max(0, (L.ni - T.niThr) / T.niStep) * T.niRate * L.dmt, L.ni > T.niThr ? `Ni above ${pct(T.niThr)}` : "not applicable"));
      charges.push(ch("Hedging charge", T.hedge === "YES" ? gross * T.lease * T.hedgeDays / T.dayCount : 0, T.hedge === "YES" ? `${pct(T.lease)} × ${T.hedgeDays}/${T.dayCount} days on metal value` : "not applied"));
      // trader layer
      const extra = [];
      if (T.trader === "YES") {
        const basisT = T.commBasis === "WET" ? L.grossKg / 1000 : L.dmt;
        extra.push(ch("Trader commission (Green Auto)", T.commission * basisT, `${T.commission} EUR/${T.commBasis === "WET" ? "wmt" : "dmt"}`));
        if (T.cashFeeIncl === "YES") extra.push(ch("Cash handling fee", T.cash * T.cashFee, `${pct(T.cashFee)} of € ${fmt(T.cash)} cash`));
      }
      const res = finish(this, L, P, fx, metals, charges.concat(extra), { warnings: L.pt > 0 ? ["Platinum is not paid"] : [] });
      res.refinerNet = res.gross - charges.reduce((s, c) => s + c.amount, 0);
      res.info.push(["Net from Umicore (before trader)", res.refinerNet, "EUR"]);
      res.info.push(["Advance payment " + pct(T.advance), res.net * T.advance, "EUR"]);
      return res;
    },
  };

  // ---------------------------------------------------------------- TECHEMET
  const TECHEMET = {
    id: "techemet", name: "Techemet", currency: "USD",
    paid: ["au", "ag", "pd", "cu"],
    benchmarks: { au: "LBMA AM/PM average", ag: "LBMA", pd: "LBMA PM", cu: "LME cash settlement" },
    notes: [
      "Payable = MIN(assay − minimum deduction, assay × maximum recovery)  (lower-of rule).",
      "Treatment and shredding are charged per WET metric tonne — differs from every other refinery.",
      "CONFLICT in the contract: treatment words say 'seven hundred', numeral says 570 (570 used). Shredding words say 'one hundred', numeral says 150 (150 used).",
      "As and Hg penalties are flat per dmt above threshold; above the rejection limit the buyer may reject the cargo.",
      "Cu refining charge is per tonne of payable copper. Nickel is not paid. No platinum paid.",
    ],
    defaults: {
      tc: 570, shred: 150, shredMm: 50, minLot: 300, minLotKg: 300,
      asPen: 10, asThr: 0.002, asRej: 0.005, hgPen: 100, hgThr: 2, hgRej: 5,
      au_min: 10, ag_min: 100, pd_min: 18, cu_min: 0.035,
      au_rec: 0.95, ag_rec: 0.95, pd_rec: 0.89, cu_rec: 1,
      au_rc: 5, ag_rc: 0.5, pd_rc: 14, cu_rc: 300,
      au_factor: 1, ag_factor: 1, pd_factor: 1, cu_factor: 1,
      advance: 0.8,
    },
    schema: [
      { title: "Commercial terms", fields: [
        ["tc", "Treatment charge", "USD/wmt", "num", "CONFLICT: words 'seven hundred', numeral 570"],
        ["shred", "Shredding charge", "USD/wmt", "num", "CONFLICT: words 'one hundred', numeral 150"],
        ["shredMm", "Shredding threshold", "mm", "num", "over 50 mm mesh"],
        ["minLot", "Minimum lot charge", "USD/lot", "num", "lot below the threshold"],
        ["minLotKg", "Minimum lot threshold", "wet kg", "num", "strictly below"],
        ["asPen", "As penalty", "USD/dmt", "num", "flat if As above threshold"],
        ["asThr", "As penalty threshold", "%", "pct", ""],
        ["asRej", "As rejection limit", "%", "pct", "above this the cargo may be rejected"],
        ["hgPen", "Hg penalty", "USD/dmt", "num", "flat if Hg above threshold"],
        ["hgThr", "Hg penalty threshold", "ppm", "num", ""],
        ["hgRej", "Hg rejection limit", "ppm", "num", "above this the cargo may be rejected"],
        ["advance", "Advance payment", "%", "pct", "within 10 working days of receipt"],
      ]},
      { title: "Metal terms", metals: ["au", "ag", "pd", "cu"], cols: [
        ["min", "Min. deduction", "g/DMT · Cu % points", "auto"], ["rec", "Max recovery", "%", "pct"],
        ["rc", "R/C", "USD/toz · Cu USD/t", "num"], ["factor", "Price factor", "%", "pct"],
      ]},
    ],
    calc(L, P, fx, T) {
      const metals = {};
      ["au", "ag", "pd", "cu"].forEach((m) => {
        const g = Math.max(0, Math.min(L[m] - T[m + "_min"], L[m] * T[m + "_rec"]));
        const qty = m === "cu" ? g * L.dryKg : g * L.dmt;
        const price = P[m] * T[m + "_factor"];
        metals[m] = { payGrade: g, qty, qtyUnit: m === "cu" ? "kg" : "g", price, priceUnit: m === "cu" ? "USD/kg" : "USD/g", value: qty * price, rule: `lower of −${m === "cu" ? pct(T[m + "_min"]) : T[m + "_min"] + " g/t"} or ${pct(T[m + "_rec"])}` };
      });
      const wmt = L.grossKg / 1000;
      const shredOn = L.pieceMm > T.shredMm;
      const charges = [
        ch("Treatment charge", T.tc * wmt, `${T.tc} USD/wmt`),
        ch("Shredding charge", shredOn ? T.shred * wmt : 0, shredOn ? `pieces > ${T.shredMm} mm` : `pieces ≤ ${T.shredMm} mm — not charged`),
        ch("Minimum lot charge", L.grossKg < T.minLotKg ? T.minLot : 0, L.grossKg < T.minLotKg ? `lot below ${T.minLotKg} wet kg` : "not applicable"),
        ch("Au refining charge", metals.au.qty / TOZ * T.au_rc, `${T.au_rc} USD/toz payable`),
        ch("Ag refining charge", metals.ag.qty / TOZ * T.ag_rc, `${T.ag_rc} USD/toz payable`),
        ch("Pd refining charge", metals.pd.qty / TOZ * T.pd_rc, `${T.pd_rc} USD/toz payable`),
        ch("Cu refining charge", metals.cu.qty / KG_PER_MT * T.cu_rc, `${T.cu_rc} USD/t payable Cu`),
        ch("As penalty", L.as > T.asThr ? T.asPen * L.dmt : 0, L.as > T.asThr ? `As above ${pct(T.asThr)}` : "not applicable"),
        ch("Hg penalty", L.hg > T.hgThr ? T.hgPen * L.dmt : 0, L.hg > T.hgThr ? `Hg above ${T.hgThr} ppm` : "not applicable"),
      ];
      const warnings = [];
      if (L.as > T.asRej) warnings.push(`REJECTABLE — As above ${pct(T.asRej)}`);
      else if (L.hg > T.hgRej) warnings.push(`REJECTABLE — Hg above ${T.hgRej} ppm`);
      if (L.pt > 0) warnings.push("Platinum is not paid");
      const res = finish(this, L, P, fx, metals, charges, { warnings });
      res.info.push(["Advance payment " + pct(T.advance), res.net * T.advance, "USD"]);
      return res;
    },
  };

  // ---------------------------------------------------------------- AURUBIS
  const AURUBIS = {
    id: "aurubis", name: "Aurubis", currency: "EUR",
    paid: ["au", "ag", "pd", "cu"],
    benchmarks: { au: "LBMA/LME at 100 % (assumed)", ag: "LBMA (assumed)", pd: "LBMA (assumed)", cu: "LME (assumed)" },
    notes: [
      "Applied deduction = MAX(assay × deduction %, minimum deduction); payable only if the assay is above the minimum deduction.",
      "Gold grade decides destination and terms: below 160 g/dmt → DDP Lünen (490 EUR/dmt); at/above → DDP Hamburg (550 EUR/dmt). Au and Pd minimum deductions also follow the gold grade (as in the source file — confirm with Aurubis).",
      "Price basis assumed LBMA/LME at 100 % — not stated in the source file.",
      "Cu refining charge is per tonne of payable copper. No platinum paid.",
    ],
    defaults: {
      auThr: 160, tcLow: 490, tcHigh: 550, smpSmall: 950, smpNormal: 650, smpThr: 10,
      au_ded: 0.02, ag_ded: 0.02, pd_ded: 0.15, cu_ded: 0,
      au_minLo: 7.5, ag_minLo: 125, pd_minLo: 8, cu_minLo: 0.025,
      au_minHi: 8, ag_minHi: 125, pd_minHi: 9, cu_minHi: 0.025,
      au_rc: 180, ag_rc: 18, pd_rc: 500, cu_rc: 475,
      prepay: 0.67, wcRate: 0.08, wcDays: 120,
    },
    schema: [
      { title: "Commercial terms", fields: [
        ["auThr", "Gold grade threshold", "g/dmt", "num", "destination, Au and Pd minimum deductions"],
        ["tcLow", "Treatment charge — below threshold", "EUR/dmt", "num", "DDP Lünen"],
        ["tcHigh", "Treatment charge — at/above threshold", "EUR/dmt", "num", "DDP Hamburg"],
        ["smpSmall", "Sampling charge — small lot", "EUR/lot", "num", "lot below the threshold"],
        ["smpNormal", "Sampling charge — normal lot", "EUR/lot", "num", "lot at/above the threshold"],
        ["smpThr", "Sampling lot threshold", "dmt", "num", "strictly less than"],
      ]},
      { title: "Metal terms", metals: ["au", "ag", "pd", "cu"], cols: [
        ["ded", "Deduction", "%", "pct"], ["minLo", "Min ded. below thr.", "g/dmt · Cu % points", "auto"],
        ["minHi", "Min ded. at/above thr.", "g/dmt · Cu % points", "auto"], ["rc", "R/C", "EUR/kg · Cu EUR/t", "num"],
      ]},
      { title: "Prepayment (information only — not deducted)", fields: [
        ["prepay", "Prepayment rate", "%", "pct", ""],
        ["wcRate", "Working-capital rate", "% / year", "pct", "manual"],
        ["wcDays", "Days funded early", "days", "num", "prepayment → final settlement"],
      ]},
    ],
    calc(L, P, fx, T) {
      const hi = L.au >= T.auThr;
      const metals = {};
      ["au", "ag", "pd", "cu"].forEach((m) => {
        const min = m === "ag" || m === "cu" ? T[m + "_minLo"] : hi ? T[m + "_minHi"] : T[m + "_minLo"];
        const ded = Math.max(L[m] * T[m + "_ded"], min);
        const g = L[m] > min ? L[m] - ded : 0;
        const qty = m === "cu" ? g * L.dryKg : g * L.dmt;     // g ; Cu kg
        const price = P[m] / fx;                              // EUR/g ; Cu EUR/kg
        metals[m] = { payGrade: g, qty, qtyUnit: m === "cu" ? "kg" : "g", price, priceUnit: m === "cu" ? "EUR/kg" : "EUR/g", value: qty * price, rule: `${pct(T[m + "_ded"])} ded., min ${m === "cu" ? pct(min) : min + " g/t"}` };
      });
      const small = L.dmt < T.smpThr;
      const charges = [
        ch("Treatment charge", (hi ? T.tcHigh : T.tcLow) * L.dmt, hi ? `${T.tcHigh} EUR/dmt — Hamburg` : `${T.tcLow} EUR/dmt — Lünen`),
        ch("Au refining charge", metals.au.qty / 1000 * T.au_rc, `${T.au_rc} EUR/kg payable`),
        ch("Ag refining charge", metals.ag.qty / 1000 * T.ag_rc, `${T.ag_rc} EUR/kg payable`),
        ch("Pd refining charge", metals.pd.qty / 1000 * T.pd_rc, `${T.pd_rc} EUR/kg payable`),
        ch("Cu refining charge", metals.cu.qty / 1000 * T.cu_rc, `${T.cu_rc} EUR/t payable Cu`),
        ch("Sampling charge", small ? T.smpSmall : T.smpNormal, small ? "small lot" : "normal lot"),
      ];
      const res = finish(this, L, P, fx, metals, charges, { warnings: L.pt > 0 ? ["Platinum is not paid"] : [] });
      res.badge = hi ? "DDP Hamburg" : "DDP Lünen";
      const pre = res.net * T.prepay;
      res.info.push(["Prepayment " + pct(T.prepay), pre, "EUR"]);
      res.info.push(["Balance at final settlement", res.net - pre, "EUR"]);
      res.info.push(["Indicative financing benefit", pre * T.wcRate * T.wcDays / 360, "EUR"]);
      return res;
    },
  };

  // ---------------------------------------------------------------- shared helpers
  const M = { au: "Au", ag: "Ag", pt: "Pt", pd: "Pd", cu: "Cu" };
  function ch(label, amount, note) { return { label, amount: n(amount), note }; }
  function sumVal(metals) { return Object.values(metals).reduce((s, x) => s + n(x.value), 0); }
  function pct(f) { return (Math.round(f * 100000) / 1000).toString() + " %"; }
  function fmt(v) { return Number(v).toLocaleString("en-GB", { maximumFractionDigits: 2 }); }

  function finish(ref, L, P, fx, metals, charges, opt) {
    const gross = sumVal(metals);
    const totalCharges = charges.reduce((s, c) => s + c.amount, 0);
    let net = gross - totalCharges;
    if (opt.forceNet !== null && opt.forceNet !== undefined) net = opt.forceNet;
    const toEUR = ref.currency === "EUR" ? 1 : 1 / fx;
    const netEUR = net * toEUR;
    // theoretical contained-metal value at 100 % of the reference price (all metals in the lot)
    const theoUSD = L.au * L.dmt * P.au + L.ag * L.dmt * P.ag + L.pd * L.dmt * P.pd + L.pt * L.dmt * P.pt + L.cu * L.dryKg * P.cu;
    const theoEUR = theoUSD / fx;
    // effective payable % per metal (payable grade / assay)
    Object.entries(metals).forEach(([m, x]) => { x.assay = L[m]; x.payPct = L[m] > 0 ? x.payGrade / L[m] : 0; });
    return {
      id: ref.id, name: ref.name, currency: ref.currency, metals, charges,
      gross, totalCharges, net, netEUR, netUSD: netEUR * fx,
      theoEUR, returnRate: theoEUR > 0 ? netEUR / theoEUR : 0,
      eurPerKg: L.grossKg > 0 ? netEUR / L.grossKg : 0,
      eurPerDmt: L.dmt > 0 ? netEUR / L.dmt : 0,
      warnings: opt.warnings || [], info: [], badge: null,
    };
  }

  // normalise a lot from the UI
  function prepareLot(lot) {
    const L = {
      grossKg: n(lot.grossKg), moisture: n(lot.moisture),
      au: n(lot.au), ag: n(lot.ag), pd: n(lot.pd), pt: n(lot.pt), cu: n(lot.cu),
      al: n(lot.al), cr: n(lot.cr), ni: n(lot.ni), as: n(lot.as), hg: n(lot.hg),
      pieceMm: n(lot.pieceMm), exempt: !!lot.exempt,
    };
    L.dryKg = L.grossKg * (1 - L.moisture);
    L.dmt = L.dryKg / 1000;
    return L;
  }

  const REFINERIES = [ASAHI, DOWA, PEDALPOINT, HANWA, UMICORE, TECHEMET, AURUBIS];

  function runAll(lot, prices, fx, termsById) {
    const L = prepareLot(lot);
    return REFINERIES.map((r) => {
      const T = Object.assign(clone(r.defaults), (termsById && termsById[r.id]) || {});
      return r.calc(L, prices, fx, T);
    });
  }

  const api = { REFINERIES, runAll, prepareLot, bracket, TOZ, LB_PER_KG, METAL_NAMES: M };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RefEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
