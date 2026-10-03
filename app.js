/* Refining Calculator — calculation logic and live Kitco prices */
(function () {
  "use strict";

  const METALS = ["au", "ag", "pt", "pd", "rh", "cu"];
  const NAMES = { au: "Au", ag: "Ag", pt: "Pt", pd: "Pd", rh: "Rh", cu: "Cu" };
  const KITCO_SYMBOL = { au: "AU", ag: "AG", pt: "PT", pd: "PD", rh: "RH", cu: "CU" };
  const OZ_PER_KG = 1000 / 31.1034768;   // troy ounces per kg
  const LB_PER_KG = 1 / 0.45359237;      // pounds per kg
  const KITCO_URL = "https://kdb-gw.prod.kitco.com/";
  const REFRESH_MS = 60 * 1000;

  // Values from the Excel file (REFFINING CATALOG — calculation rules)
  const DEFAULT_RULES = {
    defaultMT: 10,
    samplingThresholdMT: 10,
    treatment: 550,       // €/dmt
    samplingSmall: 950,   // €/lot < 10 MT
    samplingLarge: 650,   // €/lot ≥ 10 MT
    metals: {
      au: { pay: 100, yield: 98, minDed: 8,   chargeVal: 180, chargeUnit: "eur_kg" },
      ag: { pay: 100, yield: 98, minDed: 125, chargeVal: 18,  chargeUnit: "eur_kg" },
      pt: { pay: 100, yield: 85, minDed: 9,   chargeVal: 500, chargeUnit: "eur_kg" }, // not in Excel → same as Pd
      pd: { pay: 100, yield: 85, minDed: 9,   chargeVal: 500, chargeUnit: "eur_kg" },
      rh: { pay: 100, yield: 85, minDed: 9,   chargeVal: 500, chargeUnit: "eur_kg" }, // not in Excel → same as Pd
      cu: { pay: 100, yield: 100, minDed: 2.5, chargeVal: 475, chargeUnit: "eur_t" },
    },
  };

  const LS_RULES = "rc_rules_v1";
  const LS_ANALYSES = "rc_analyses_v1";
  const LS_CURRENT = "rc_current_v1";
  const LS_OVERRIDE = "rc_price_override_v1";
  const LS_LASTPRICES = "rc_last_prices_v1";

  // ---------- storage helpers ----------
  const load = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let rules = mergeRules(load(LS_RULES, null));
  let analyses = load(LS_ANALYSES, []);
  let currentId = load(LS_CURRENT, null);
  let overrides = load(LS_OVERRIDE, {});
  let livePrices = load(LS_LASTPRICES, { prices: {}, time: null }).prices || {};
  let livePricesTime = load(LS_LASTPRICES, { time: null }).time;

  function mergeRules(r) {
    const base = clone(DEFAULT_RULES);
    if (!r) return base;
    const out = Object.assign(base, r, { metals: base.metals });
    METALS.forEach((m) => { out.metals[m] = Object.assign({}, base.metals[m], (r.metals || {})[m] || {}); });
    return out;
  }

  // ---------- formatting ----------
  const nf = (d) => new Intl.NumberFormat("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtEur = (v) => (isFinite(v) ? nf(2).format(v) + " €" : "–");
  const fmtNum = (v, d = 2) => (isFinite(v) ? nf(d).format(v) : "–");
  const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : 0; };
  function fmtMass(kg) {
    if (!isFinite(kg)) return "–";
    if (kg === 0) return "0";
    if (Math.abs(kg) < 1) return fmtNum(kg * 1000, 2) + " g";
    if (Math.abs(kg) >= 1000) return fmtNum(kg / 1000, 3) + " t";
    return fmtNum(kg, 3) + " kg";
  }

  // ---------- analyses ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const today = () => new Date().toISOString().slice(0, 10);

  function newAnalysis() {
    const a = {
      id: uid(),
      lot: "lot#" + (analyses.length + 1),
      qtyKg: rules.defaultMT * 1000,
      moisture: 0,
      date: today(),
      notes: "",
      grades: { au: "", ag: "", pt: "", pd: "", rh: "", cu: "" },
    };
    analyses.unshift(a);
    currentId = a.id;
    persist();
    return a;
  }
  const current = () => analyses.find((a) => a.id === currentId);
  function persist() {
    save(LS_ANALYSES, analyses);
    save(LS_CURRENT, currentId);
  }

  // ---------- calculation ----------
  function priceFor(m) {
    const o = overrides[m];
    if (o !== undefined && o !== "" && isFinite(num(o)) && num(o) > 0) return { v: num(o), manual: true };
    return { v: livePrices[m], manual: false };
  }

  function calculate(a) {
    const wetT = num(a.qtyKg) / 1000;
    const dryT = wetT * (1 - num(a.moisture) / 100);
    const per = {};
    let sumValue = 0, sumRefine = 0;

    METALS.forEach((m) => {
      const r = rules.metals[m];
      const grade = num(a.grades[m]);                       // g/t or %
      const deduction = Math.max(grade * (1 - num(r.yield) / 100), num(r.minDed));
      const payGrade = Math.max(0, grade - deduction) * (num(r.pay) / 100);

      // metal content in kg
      const toKg = m === "cu" ? (g) => (g / 100) * dryT * 1000 : (g) => (g * dryT) / 1000;
      const contentKg = toKg(grade);
      const payableKg = toKg(payGrade);

      const price = priceFor(m).v;
      const value = isFinite(price) ? payableKg * price : NaN;
      const refine = r.chargeUnit === "eur_t" ? (payableKg / 1000) * num(r.chargeVal) : payableKg * num(r.chargeVal);
      const net = value - refine;

      per[m] = { grade, payGrade, contentKg, payableKg, value, refine, net, price };
      if (isFinite(value)) sumValue += value;
      sumRefine += refine;
    });

    const treatment = dryT * num(rules.treatment);
    const sampling = wetT <= 0 ? 0 : wetT < num(rules.samplingThresholdMT) ? num(rules.samplingSmall) : num(rules.samplingLarge);
    const total = sumValue - sumRefine - treatment - sampling;
    const missingPrice = METALS.some((m) => per[m].grade > 0 && !isFinite(per[m].price));

    return { wetT, dryT, per, sumValue, sumRefine, treatment, sampling, total, missingPrice };
  }

  // ---------- DOM ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const inLot = $("#inLot"), inQty = $("#inQty"), inMoist = $("#inMoist"), inDate = $("#inDate"), inNotes = $("#inNotes");
  const selAnalysis = $("#selAnalysis");

  function fillSelect() {
    selAnalysis.innerHTML = "";
    analyses.forEach((a) => {
      const o = document.createElement("option");
      o.value = a.id;
      o.textContent = `${a.lot || "(no name)"} · ${fmtNum(num(a.qtyKg), 0)} kg${a.date ? " · " + a.date : ""}`;
      if (a.id === currentId) o.selected = true;
      selAnalysis.appendChild(o);
    });
  }

  function loadIntoForm() {
    const a = current();
    inLot.value = a.lot || "";
    inQty.value = a.qtyKg ?? "";
    inMoist.value = a.moisture ?? 0;
    inDate.value = a.date || "";
    inNotes.value = a.notes || "";
    $$("[data-a]").forEach((inp) => { inp.value = a.grades[inp.dataset.a] ?? ""; });
  }

  function setRow(cls, fn) {
    $$(`.${cls} td[data-m]`).forEach((td) => { td.innerHTML = fn(td.dataset.m); });
  }

  function render() {
    const a = current();
    const c = calculate(a);

    setRow("r-price", (m) => {
      const p = priceFor(m);
      return isFinite(p.v) ? fmtNum(p.v, 2) : "–";
    });
    $$(".r-price td[data-m]").forEach((td) => td.classList.toggle("manual", priceFor(td.dataset.m).manual));
    setRow("r-total", (m) => fmtMass(c.per[m].contentKg));
    setRow("r-payable", (m) => {
      const p = c.per[m];
      const unit = m === "cu" ? "%" : "g/t";
      return `${fmtMass(p.payableKg)}<small>${fmtNum(p.payGrade, m === "cu" ? 2 : 1)} ${unit}</small>`;
    });
    setRow("r-value", (m) => fmtEur(c.per[m].value));
    setRow("r-refine", (m) => (c.per[m].refine ? "−" + fmtEur(c.per[m].refine) : fmtEur(0)));
    setRow("r-net", (m) => fmtEur(c.per[m].net));

    $("#sValue").textContent = fmtEur(c.sumValue);
    $("#sRefine").textContent = "−" + fmtEur(c.sumRefine);
    $("#sTreatLbl").textContent = `Treatment (${fmtNum(c.dryT, 3)} dmt × ${fmtNum(num(rules.treatment), 0)} €)`;
    $("#sTreat").textContent = "−" + fmtEur(c.treatment);
    $("#sSampLbl").textContent = `Sampling (lot ${c.wetT < num(rules.samplingThresholdMT) ? "<" : "≥"} ${fmtNum(num(rules.samplingThresholdMT), 0)} MT)`;
    $("#sSamp").textContent = "−" + fmtEur(c.sampling);
    const tot = $("#sTotal");
    tot.textContent = fmtEur(c.total);
    tot.classList.toggle("negative", c.total < 0);
    $("#sPerKg").textContent = c.missingPrice
      ? "Missing price for an analysed metal"
      : c.wetT > 0 ? `${fmtNum(c.total / (c.wetT * 1000), 3)} €/kg material` : "";

    renderOverrideTable();
  }

  // form listeners
  function updateField(fn) {
    const a = current(); fn(a); persist(); render(); fillSelect();
  }
  inLot.addEventListener("input", () => updateField((a) => (a.lot = inLot.value)));
  inQty.addEventListener("input", () => updateField((a) => (a.qtyKg = inQty.value)));
  inMoist.addEventListener("input", () => updateField((a) => (a.moisture = inMoist.value)));
  inDate.addEventListener("input", () => updateField((a) => (a.date = inDate.value)));
  inNotes.addEventListener("input", () => updateField((a) => (a.notes = inNotes.value)));
  $$("[data-a]").forEach((inp) => inp.addEventListener("input", () => updateField((a) => (a.grades[inp.dataset.a] = inp.value))));

  selAnalysis.addEventListener("change", () => { currentId = selAnalysis.value; persist(); loadIntoForm(); render(); });
  $("#btnNew").addEventListener("click", () => { newAnalysis(); fillSelect(); loadIntoForm(); render(); inLot.focus(); inLot.select(); });
  $("#btnDup").addEventListener("click", () => {
    const a = clone(current()); a.id = uid(); a.lot = (a.lot || "") + " (copy)"; a.date = today();
    analyses.unshift(a); currentId = a.id; persist(); fillSelect(); loadIntoForm(); render();
  });
  $("#btnDel").addEventListener("click", () => {
    const a = current();
    if (!confirm(`Delete analysis "${a.lot}"?`)) return;
    analyses = analyses.filter((x) => x.id !== a.id);
    if (!analyses.length) newAnalysis(); else currentId = analyses[0].id;
    persist(); fillSelect(); loadIntoForm(); render();
  });

  // tabs
  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
    $$(".tabpanel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + t.dataset.tab));
  }));

  // ---------- rules UI ----------
  function buildRulesUI() {
    const tb = $("#metalRules tbody");
    tb.innerHTML = "";
    METALS.forEach((m) => {
      const r = rules.metals[m];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><b>${NAMES[m]}</b></td>
        <td><input data-r="${m}.pay" type="number" step="any" value="${r.pay}"></td>
        <td><input data-r="${m}.yield" type="number" step="any" value="${r.yield}"></td>
        <td><input data-r="${m}.minDed" type="number" step="any" value="${r.minDed}"></td>
        <td>${m === "cu" ? "%-points" : "g/t"}</td>
        <td><input data-r="${m}.chargeVal" type="number" step="any" value="${r.chargeVal}"></td>
        <td><select data-r="${m}.chargeUnit">
              <option value="eur_kg"${r.chargeUnit === "eur_kg" ? " selected" : ""}>€/kg metal</option>
              <option value="eur_t"${r.chargeUnit === "eur_t" ? " selected" : ""}>€/t metal</option>
            </select></td>`;
      tb.appendChild(tr);
    });
    $$("[data-r]").forEach((el) => el.addEventListener("input", () => {
      const [m, k] = el.dataset.r.split(".");
      rules.metals[m][k] = k === "chargeUnit" ? el.value : el.value === "" ? 0 : num(el.value);
      save(LS_RULES, rules); render();
    }));
    $$("[data-s]").forEach((el) => {
      el.value = rules[el.dataset.s];
      el.oninput = () => { rules[el.dataset.s] = num(el.value); save(LS_RULES, rules); render(); };
    });
  }
  $("#btnResetRules").addEventListener("click", () => {
    if (!confirm("Reset all rules to the Excel values?")) return;
    rules = clone(DEFAULT_RULES); save(LS_RULES, rules); buildRulesUI(); render();
  });

  function renderOverrideTable() {
    const tb = $("#overrideTable tbody");
    if (!tb.children.length) {
      METALS.forEach((m) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td><b>${NAMES[m]}</b></td><td data-live="${m}"></td>
          <td><input data-o="${m}" type="number" step="any" placeholder="live" value="${overrides[m] ?? ""}"></td>`;
        tb.appendChild(tr);
      });
      $$("[data-o]").forEach((el) => el.addEventListener("input", () => {
        if (el.value === "") delete overrides[el.dataset.o]; else overrides[el.dataset.o] = el.value;
        save(LS_OVERRIDE, overrides); render();
      }));
    }
    $$("[data-live]").forEach((td) => { td.textContent = fmtNum(livePrices[td.dataset.live], 2); });
  }

  // ---------- backup ----------
  $("#btnExport").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ analyses, rules, exported: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `refining-analyses-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#inImport").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const incoming = Array.isArray(data) ? data : data.analyses || [];
      const ids = new Set(analyses.map((a) => a.id));
      incoming.forEach((a) => { if (!ids.has(a.id)) analyses.push(a); });
      if (data.rules && confirm("The file also contains calculation rules. Load them too?")) {
        rules = mergeRules(data.rules); save(LS_RULES, rules); buildRulesUI();
      }
      persist(); fillSelect(); render();
      alert(`Imported: ${incoming.length} analyses.`);
    } catch (err) { alert("Invalid file: " + err.message); }
    e.target.value = "";
  });

  // ---------- live prices (Kitco, Bid, EUR) ----------
  const priceDot = $("#priceDot"), priceStatus = $("#priceStatus");

  async function fetchPrices() {
    const parts = METALS.map((m) =>
      m === "cu"
        ? `${m}: GetMetalQuote(symbol: "${KITCO_SYMBOL[m]}", currency: $c) { results { bid unit originalTime } }`
        : `${m}: GetMetalQuoteV3(symbol: "${KITCO_SYMBOL[m]}", currency: $c) { results { bid unit originalTime } }`
    ).join("\n");
    const query = `query ($c: String!) {\n${parts}\n}`;
    priceStatus.textContent = "Updating…";
    try {
      const res = await fetch(KITCO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { c: "EUR" } }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      const d = json.data || {};
      let newest = null;
      METALS.forEach((m) => {
        const r = d[m] && d[m].results && d[m].results[0];
        if (!r || !isFinite(r.bid)) return;
        const unit = String(r.unit || "").toUpperCase();
        const perKg = unit === "POUND" ? r.bid * LB_PER_KG
                    : unit === "KILO" || unit === "KILOGRAM" ? r.bid
                    : unit === "GRAM" ? r.bid * 1000
                    : r.bid * OZ_PER_KG; // OUNCE (troy)
        livePrices[m] = perKg;
        if (r.originalTime && (!newest || r.originalTime > newest)) newest = r.originalTime;
      });
      livePricesTime = newest || new Date().toISOString();
      save(LS_LASTPRICES, { prices: livePrices, time: livePricesTime });
      priceDot.className = "dot ok";
      priceStatus.textContent = "Kitco bid · " + stamp(livePricesTime);
    } catch (err) {
      priceDot.className = "dot err";
      priceStatus.textContent = livePricesTime
        ? "Update failed — last prices: " + stamp(livePricesTime)
        : "Could not load prices (" + err.message + ")";
    }
    render();
  }
  function stamp(iso) {
    const t = new Date(iso);
    return isNaN(t) ? "" : t.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  $("#btnRefresh").addEventListener("click", fetchPrices);

  // ---------- init ----------
  if (!analyses.length) newAnalysis();
  if (!current()) { currentId = analyses[0].id; persist(); }
  buildRulesUI();
  fillSelect();
  loadIntoForm();
  render();
  fetchPrices();
  setInterval(fetchPrices, REFRESH_MS);

  // exposed for testing
  window.__rc = { calculate, rules: () => rules, livePrices: () => livePrices };
})();
