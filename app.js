/* Refining Calculator — UI: lots, refinery comparison, editable terms, live Kitco prices */
(function () {
  "use strict";
  const E = window.RefEngine;
  const REFS = E.REFINERIES;
  const TOZ = E.TOZ;
  const METALS = ["au", "ag", "pd", "pt", "cu"];
  const MN = { au: "Au", ag: "Ag", pd: "Pd", pt: "Pt", cu: "Cu" };
  const FULL = { au: "gold", ag: "silver", pd: "palladium", pt: "platinum", cu: "copper" };
  const KITCO_URL = "https://kdb-gw.prod.kitco.com/";
  const REFRESH_MS = 60 * 1000;

  // ---------- storage ----------
  const K = { lots: "rc2_lots", cur: "rc2_current", terms: "rc2_terms", ovr: "rc2_price_override", fx: "rc2_fx", last: "rc2_last_prices", open: "rc2_open", lib: "rc2_library" };
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let lots = load(K.lots, null);
  let currentId = load(K.cur, null);
  let termsOv = load(K.terms, {});          // { refId: { key: value } }
  let overrides = load(K.ovr, {});          // { au: USD/toz, ..., cu: USD/t }
  let fxCfg = load(K.fx, { mode: "live", manual: 1.161875 });
  let last = load(K.last, { usd: {}, fx: null, time: null });
  let openCards = new Set(load(K.open, []));
  let termsRef = REFS[0].id;

  // ---------- lots ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const today = () => new Date().toISOString().slice(0, 10);
  function blankLot(name) {
    return { id: uid(), lot: name, material: "", date: today(), notes: "",
      grossKg: 1000, moisturePct: 0, au: "", ag: "", pd: "", pt: "", cuPct: "",
      alPct: 0, crPct: 0, niPct: 0, asPct: 0, hgPpm: 0, pieceMm: 100, exempt: false };
  }
  if (!lots) {
    // migrate lots from the first version of the site, if any
    const old = load("rc_analyses_v1", []);
    lots = old.map((a) => Object.assign(blankLot(a.lot || "lot"), {
      id: a.id, date: a.date || today(), notes: a.notes || "", grossKg: a.qtyKg, moisturePct: a.moisture || 0,
      au: a.grades?.au ?? "", ag: a.grades?.ag ?? "", pd: a.grades?.pd ?? "", pt: a.grades?.pt ?? "", cuPct: a.grades?.cu ?? "",
    }));
    if (!lots.length) {
      // example lot = the LOT_INPUT sheet of REFINERY_COMPARISON.xlsx
      lots = [Object.assign(blankLot("Example (Excel lot)"), { grossKg: 22000, au: 10.8, ag: 489, pd: 1, pt: 0, cuPct: 15.64, material: "PCB" })];
    }
    currentId = lots[0].id;
    persistLots();
  }
  if (!lots.find((l) => l.id === currentId)) currentId = lots[0].id;
  const cur = () => lots.find((l) => l.id === currentId);
  function persistLots() { save(K.lots, lots); save(K.cur, currentId); }

  const num = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(x) ? x : 0; };
  function toEngineLot(l) {
    return { grossKg: num(l.grossKg), moisture: num(l.moisturePct) / 100,
      au: num(l.au), ag: num(l.ag), pd: num(l.pd), pt: num(l.pt), cu: num(l.cuPct) / 100,
      al: num(l.alPct) / 100, cr: num(l.crPct) / 100, ni: num(l.niPct) / 100, as: num(l.asPct) / 100, hg: num(l.hgPpm),
      pieceMm: num(l.pieceMm), exempt: !!l.exempt };
  }

  // ---------- prices ----------
  // engine wants USD/g for precious metals and USD/kg for copper
  function priceUSD() {
    const p = {}, src = {};
    METALS.forEach((m) => {
      const o = overrides[m];
      if (o !== undefined && o !== "" && num(o) > 0) { p[m] = m === "cu" ? num(o) / 1000 : num(o) / TOZ; src[m] = "manual"; }
      else { p[m] = last.usd[m]; src[m] = "live"; }
    });
    return { p, src };
  }
  function fxRate() {
    if (fxCfg.mode === "manual" && num(fxCfg.manual) > 0) return num(fxCfg.manual);
    return last.fx;
  }
  const pricesReady = () => { const { p } = priceUSD(); return METALS.every((m) => isFinite(p[m]) && p[m] > 0) && isFinite(fxRate()) && fxRate() > 0; };

  // ---------- formatting ----------
  const nf = (d) => new Intl.NumberFormat("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const f0 = (v) => (isFinite(v) ? nf(0).format(v) : "–");
  const f2 = (v) => (isFinite(v) ? nf(2).format(v) : "–");
  const fN = (v, d) => (isFinite(v) ? nf(d).format(v) : "–");
  const money = (v, c) => (isFinite(v) ? (v < 0 ? "−" : "") + (c === "USD" ? "$" : "€") + nf(2).format(Math.abs(v)) : "–");
  const money0 = (v, c) => (isFinite(v) ? (v < 0 ? "−" : "") + (c === "USD" ? "$" : "€") + nf(0).format(Math.abs(v)) : "–");
  const pctS = (f, d = 1) => (isFinite(f) ? nf(d).format(f * 100) + " %" : "–");
  function mass(qty, unit) {
    if (!isFinite(qty)) return "–";
    if (unit === "kg") return qty >= 1000 ? fN(qty / 1000, 3) + " t" : fN(qty, 1) + " kg";
    return qty >= 1000 ? fN(qty / 1000, 3) + " kg" : fN(qty, 2) + " g";
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ================= LOT FORM =================
  const FIELDS = ["lot", "material", "grossKg", "moisturePct", "au", "ag", "pd", "pt", "cuPct", "alPct", "crPct", "niPct", "asPct", "hgPpm", "pieceMm", "date", "notes"];
  function fillSelect() {
    const s = $("#selLot"); s.innerHTML = "";
    lots.forEach((l) => {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = `${l.lot || "(no name)"} · ${f0(num(l.grossKg))} kg${l.date ? " · " + l.date : ""}`;
      o.selected = l.id === currentId;
      s.appendChild(o);
    });
  }
  function loadForm() {
    const l = cur();
    FIELDS.forEach((k) => { $("#f_" + k).value = l[k] ?? ""; });
    $("#f_exempt").checked = !!l.exempt;
    updateMoreHint();
    renderComp();
  }
  function updateMoreHint() {
    const l = cur();
    const set = ["alPct", "crPct", "niPct", "asPct", "hgPpm"].filter((k) => num(l[k]) > 0).length;
    $("#moreHint").textContent = `piece ${f0(num(l.pieceMm))} mm${set ? ` · ${set} impurit${set > 1 ? "ies" : "y"} set` : ""}${l.exempt ? " · exempt" : ""}`;
  }
  FIELDS.forEach((k) => $("#f_" + k).addEventListener("input", (e) => {
    cur()[k] = e.target.value; persistLots(); updateMoreHint();
    if (k === "lot" || k === "grossKg" || k === "date") fillSelect();
    render();
  }));
  $("#f_exempt").addEventListener("change", (e) => { cur().exempt = e.target.checked; persistLots(); updateMoreHint(); render(); });
  $("#selLot").addEventListener("change", (e) => { currentId = e.target.value; persistLots(); loadForm(); render(); });
  $("#btnNew").addEventListener("click", () => {
    const l = blankLot("lot#" + (lots.length + 1)); lots.unshift(l); currentId = l.id; persistLots(); fillSelect(); loadForm(); render();
    $("#f_lot").focus(); $("#f_lot").select();
  });
  $("#btnDup").addEventListener("click", () => {
    const l = clone(cur()); l.id = uid(); l.lot = (l.lot || "") + " (copy)"; l.date = today();
    lots.unshift(l); currentId = l.id; persistLots(); fillSelect(); loadForm(); render();
  });
  $("#btnDel").addEventListener("click", () => {
    const l = cur(); if (!confirm(`Delete lot "${l.lot}"?`)) return;
    lots = lots.filter((x) => x.id !== l.id);
    if (!lots.length) lots.push(blankLot("lot#1"));
    currentId = lots[0].id; persistLots(); fillSelect(); loadForm(); render();
  });

  // ================= COMPARISON =================
  function render() {
    renderPriceBits();
    const rank = $("#ranking");
    const l = cur();
    const L = E.prepareLot(toEngineLot(l));
    $("#weights").innerHTML = L.grossKg > 0
      ? `<span>Gross <b>${f0(L.grossKg)} kg</b></span><span>Dry <b>${fN(L.dmt, 3)} dmt</b></span>${num(l.moisturePct) ? `<span>Moisture <b>${fN(num(l.moisturePct), 2)} %</b></span>` : ""}`
      : "";
    if (!pricesReady()) {
      rank.innerHTML = `<div class="card empty">Waiting for metal prices… If this persists, enter prices manually on the <b>Prices</b> tab.</div>`;
      setBest(null); return;
    }
    if (!(L.grossKg > 0)) { rank.innerHTML = `<div class="card empty">Enter the gross weight of the lot.</div>`; setBest(null); return; }

    const { p } = priceUSD();
    const fx = fxRate();
    const results = E.runAll(toEngineLot(l), p, fx, termsOv).sort((a, b) => b.netEUR - a.netEUR);
    const best = results[0];
    const maxNet = Math.max(...results.map((r) => r.netEUR), 1);

    rank.innerHTML = results.map((r, i) => cardHTML(r, i, best, maxNet)).join("");
    $$(".rcard", rank).forEach((el) => {
      $(".rhead", el).addEventListener("click", () => {
        const id = el.dataset.id;
        el.classList.toggle("open");
        if (el.classList.contains("open")) openCards.add(id); else openCards.delete(id);
        save(K.open, [...openCards]);
      });
      const eb = $(".editterms", el);
      if (eb) eb.addEventListener("click", (ev) => { ev.stopPropagation(); termsRef = el.dataset.id; switchTab("terms"); });
    });
    setBest(best);
  }

  function cardHTML(r, i, best, maxNet) {
    const isBest = i === 0 && r.netEUR > 0;
    const diff = r.netEUR - best.netEUR;
    const barW = Math.max(0, Math.min(100, (r.netEUR / maxNet) * 100));
    const warn = r.warnings.map((w) => `<span class="warn">${esc(w)}</span>`).join("");
    const ref = REFS.find((x) => x.id === r.id);
    const modified = termsOv[r.id] && Object.keys(termsOv[r.id]).length;
    const payRow = ref.paid.map((m) => {
      const x = r.metals[m];
      return x && x.assay > 0 ? `<span><b>${MN[m]}</b> ${pctS(x.payPct, 0)}</span>` : "";
    }).join("");

    const metalRows = Object.entries(r.metals).map(([m, x]) => `
      <tr${x.assay > 0 ? "" : ' class="zero"'}>
        <td><b>${MN[m]}</b><small>${esc(x.rule)}</small></td>
        <td>${m === "cu" ? fN(x.assay * 100, 2) + " %" : fN(x.assay, 2)}</td>
        <td>${m === "cu" ? fN(x.payGrade * 100, 3) + " %" : fN(x.payGrade, 2)}<small>${pctS(x.payPct, 1)}</small></td>
        <td>${mass(x.qty, x.qtyUnit)}</td>
        <td>${money(x.value, r.currency)}</td>
      </tr>`).join("");
    const active = r.charges.filter((c) => Math.abs(c.amount) > 1e-9);
    const idle = r.charges.filter((c) => Math.abs(c.amount) <= 1e-9);
    const chargeRows = active.map((c) => `<li><span>${esc(c.label)}<small>${esc(c.note)}</small></span><b>−${money(c.amount, r.currency).replace("−", "")}</b></li>`).join("");
    const idleTxt = idle.length ? `<p class="idle">Not charged: ${idle.map((c) => esc(c.label.replace(" charge", "").replace(" refining", " R/C"))).join(", ")}</p>` : "";
    const info = r.info.map(([k, v, c]) => `<li><span>${esc(k)}</span><b>${money(v, c)}</b></li>`).join("");

    return `
    <article class="rcard${isBest ? " best" : ""}${openCards.has(r.id) ? " open" : ""}" data-id="${r.id}">
      <button class="rhead" type="button" aria-expanded="${openCards.has(r.id)}">
        <span class="rank">${i + 1}</span>
        <span class="rname">${esc(r.name)}
          <small>${r.currency} contract${r.badge ? " · " + esc(r.badge) : ""}${modified ? " · terms edited" : ""}</small>
        </span>
        <span class="rnet">${money0(r.netEUR, "EUR")}
          <small>${fN(r.eurPerKg, 3)} €/kg · ${pctS(r.returnRate, 1)}</small>
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
      <div class="rbar"><i style="width:${barW}%"></i></div>
      <div class="rsub">
        <span class="pay">${payRow || "<span>nothing payable</span>"}</span>
        ${i > 0 ? `<span class="gap">${money0(diff, "EUR")} vs #1</span>` : isBest ? '<span class="tag">Best offer</span>' : ""}
      </div>
      ${warn ? `<div class="warns">${warn}</div>` : ""}
      <div class="rbody">
        <div class="table-wrap">
          <table class="mt">
            <thead><tr><th>Metal</th><th>Assay</th><th>Payable</th><th>Qty</th><th>Value</th></tr></thead>
            <tbody>${metalRows}</tbody>
          </table>
        </div>
        <ul class="lines">
          <li class="sum"><span>Gross payable metal value</span><b>${money(r.gross, r.currency)}</b></li>
          ${chargeRows}
          <li class="sum"><span>Total charges</span><b>−${money(r.totalCharges, r.currency).replace("−", "")}</b></li>
          <li class="net"><span>Net settlement</span><b>${money(r.net, r.currency)}</b></li>
          ${r.currency === "USD" ? `<li><span>Net in EUR</span><b>${money(r.netEUR, "EUR")}</b></li>` : `<li><span>Net in USD</span><b>${money(r.netUSD, "USD")}</b></li>`}
          <li><span>Net per dmt</span><b>${money(r.eurPerDmt, "EUR")}</b></li>
          ${info}
        </ul>
        ${idleTxt}
        <button class="btn ghost editterms" type="button">View / edit ${esc(r.name)} terms</button>
      </div>
    </article>`;
  }

  function setBest(best) {
    const bar = $("#bestBar");
    if (!best) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    $("#bestLbl").textContent = "Best · " + best.name;
    $("#bestVal").textContent = money0(best.netEUR, "EUR");
  }
  $("#bestBar").addEventListener("click", () => { switchTab("calc"); $("#ranking").scrollIntoView({ behavior: "smooth", block: "start" }); });

  // ================= TERMS =================
  function T(refId) { const r = REFS.find((x) => x.id === refId); return Object.assign(clone(r.defaults), termsOv[refId] || {}); }
  function setTerm(refId, key, val) {
    const def = REFS.find((x) => x.id === refId).defaults[key];
    termsOv[refId] = termsOv[refId] || {};
    if (JSON.stringify(def) === JSON.stringify(val)) delete termsOv[refId][key]; else termsOv[refId][key] = val;
    if (!Object.keys(termsOv[refId]).length) delete termsOv[refId];
    save(K.terms, termsOv);
    renderRefChips();
    render();
  }
  // display helpers: fractions shown as percent
  const showPct = (v) => (v === "" || v === null || v === undefined ? "" : +(v * 100).toFixed(6));
  const readPct = (s) => num(s) / 100;

  function renderRefChips() {
    $("#refChips").innerHTML = REFS.map((r) => {
      const mod = termsOv[r.id] && Object.keys(termsOv[r.id]).length;
      return `<button class="chip${r.id === termsRef ? " active" : ""}" data-ref="${r.id}">${esc(r.name)}${mod ? " •" : ""}</button>`;
    }).join("");
    $$("#refChips .chip").forEach((b) => b.addEventListener("click", () => { termsRef = b.dataset.ref; renderRefChips(); renderTerms(); }));
  }

  function renderTerms() {
    const ref = REFS.find((x) => x.id === termsRef);
    const t = T(ref.id);
    const ov = termsOv[ref.id] || {};
    const isMod = (k) => Object.prototype.hasOwnProperty.call(ov, k);
    let h = `<div class="card-head"><h2>${esc(ref.name)} <small class="cur">${ref.currency} contract</small></h2>
      <button class="btn ghost" id="btnResetRef"${Object.keys(ov).length ? "" : " disabled"}>Reset to Excel values</button></div>`;
    h += `<ul class="notes">${ref.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    h += `<div class="bench"><b>Contract price benchmarks</b> (the site uses the live Kitco bid for all):
      ${Object.entries(ref.benchmarks).map(([m, b]) => `<span><b>${MN[m]}</b> ${esc(b)}</span>`).join("")}</div>`;

    ref.schema.forEach((sec) => {
      h += `<h3>${esc(sec.title)}</h3>`;
      if (sec.fields) {
        h += `<div class="tfields">` + sec.fields.map(([k, label, unit, type, note]) => {
          let input;
          if (type.startsWith("sel:")) {
            input = `<select data-k="${k}" data-t="sel">${type.slice(4).split(",").map((o) => `<option${t[k] === o ? " selected" : ""}>${o}</option>`).join("")}</select>`;
          } else {
            input = `<input data-k="${k}" data-t="${type}" type="number" step="any" inputmode="decimal" value="${type === "pct" ? showPct(t[k]) : t[k]}">`;
          }
          return `<label class="tf${isMod(k) ? " mod" : ""}"><span class="tl">${esc(label)}${note ? `<small>${esc(note)}</small>` : ""}</span>
            <span class="ti">${input}<i>${esc(unit)}</i></span></label>`;
        }).join("") + `</div>`;
      }
      if (sec.metals) {
        h += `<div class="mterms">` + sec.metals.map((m) => `
          <div class="mrow"><div class="mlabel"><b>${MN[m]}</b> ${FULL[m]}</div>
          ${sec.cols.map(([c, label, unit, type]) => {
            const k = `${m}_${c}`; const tp = type === "auto" ? (m === "cu" ? "pct" : "num") : type;
            const u = type === "auto" ? (m === "cu" ? "%" : unit.split("·")[0].trim()) : unit.includes("·") ? (m === "cu" ? unit.split("·")[1].replace("Cu", "").trim() : unit.split("·")[0].trim()) : unit;
            return `<label class="mf${isMod(k) ? " mod" : ""}"><span>${esc(label)}</span><span class="ti"><input data-k="${k}" data-t="${tp}" type="number" step="any" inputmode="decimal" value="${tp === "pct" ? showPct(t[k]) : t[k]}"><i>${esc(u)}</i></span></label>`;
          }).join("")}</div>`).join("") + `</div>`;
      }
      if (sec.brackets) {
        h += `<div class="brackets">` + sec.brackets.map(([k, m, unit, ftype]) => `
          <div class="bt${isMod(k) ? " mod" : ""}"><div class="bth"><b>${m}</b><span>from (${unit})</span><span>rate %</span></div>
          ${t[k].map((row, i) => `<div class="btr">
              <input data-br="${k}" data-i="${i}" data-c="0" data-t="${ftype}" type="number" step="any" inputmode="decimal" value="${ftype === "pct" ? showPct(row[0]) : row[0]}">
              <input data-br="${k}" data-i="${i}" data-c="1" data-t="pct" type="number" step="any" inputmode="decimal" value="${showPct(row[1])}">
              <button class="x" data-del="${k}" data-i="${i}" title="Remove row" aria-label="Remove row">×</button></div>`).join("")}
          <button class="btn tiny add" data-add="${k}">+ row</button></div>`).join("") + `</div>`;
      }
      if (sec.tiers) {
        h += `<div class="brackets">` + sec.tiers.map(([k, m]) => `
          <div class="bt tiers${isMod(k) ? " mod" : ""}"><div class="bth"><b>${m}</b><span>up to g/t</span><span>mode</span><span>value</span></div>
          ${t[k].map(([upTo, mode, v], i) => `<div class="btr">
              <input data-tier="${k}" data-i="${i}" data-c="0" type="text" inputmode="decimal" value="${upTo}">
              <select data-tier="${k}" data-i="${i}" data-c="1"><option${mode === "DEDUCT" ? " selected" : ""}>DEDUCT</option><option${mode === "RECOVERY" ? " selected" : ""}>RECOVERY</option></select>
              <span class="ti"><input data-tier="${k}" data-i="${i}" data-c="2" type="number" step="any" inputmode="decimal" value="${mode === "RECOVERY" ? showPct(v) : v}"><i>${mode === "RECOVERY" ? "%" : "g/t"}</i></span></div>`).join("")}
          </div>`).join("") + `<p class="note">Last tier "up to" = ABOVE. DEDUCT value in g/t, RECOVERY value in %.</p></div>`;
      }
    });
    $("#termsCard").innerHTML = h;

    // wire inputs
    $$("#termsCard [data-k]").forEach((el) => el.addEventListener("change", () => {
      const k = el.dataset.k, tp = el.dataset.t;
      setTerm(ref.id, k, tp === "sel" ? el.value : tp === "pct" ? readPct(el.value) : num(el.value));
      el.closest(".tf, .mf")?.classList.add("mod");
      $("#btnResetRef").disabled = false;
    }));
    $$("#termsCard [data-br]").forEach((el) => el.addEventListener("change", () => {
      const k = el.dataset.br, i = +el.dataset.i, c = +el.dataset.c;
      const arr = clone(T(ref.id)[k]);
      arr[i][c] = el.dataset.t === "pct" ? readPct(el.value) : num(el.value);
      arr.sort((a, b) => a[0] - b[0]);
      setTerm(ref.id, k, arr); renderTerms();
    }));
    $$("#termsCard [data-del]").forEach((el) => el.addEventListener("click", () => {
      const k = el.dataset.del; const arr = clone(T(ref.id)[k]); arr.splice(+el.dataset.i, 1);
      setTerm(ref.id, k, arr); renderTerms();
    }));
    $$("#termsCard [data-add]").forEach((el) => el.addEventListener("click", () => {
      const k = el.dataset.add; const arr = clone(T(ref.id)[k]); const lastRow = arr[arr.length - 1] || [0, 0];
      arr.push([lastRow[0] * 2 || 1, lastRow[1]]); setTerm(ref.id, k, arr); renderTerms();
    }));
    $$("#termsCard [data-tier]").forEach((el) => el.addEventListener("change", () => {
      const k = el.dataset.tier, i = +el.dataset.i, c = +el.dataset.c;
      const arr = clone(T(ref.id)[k]); const row = arr[i];
      if (c === 0) row[0] = /above/i.test(el.value) ? "ABOVE" : num(el.value);
      if (c === 1) { row[1] = el.value; }
      if (c === 2) row[2] = row[1] === "RECOVERY" ? readPct(el.value) : num(el.value);
      setTerm(ref.id, k, arr); renderTerms();
    }));
    $("#btnResetRef").addEventListener("click", () => {
      if (!confirm(`Reset all ${ref.name} terms to the Excel values?`)) return;
      delete termsOv[ref.id]; save(K.terms, termsOv); renderRefChips(); renderTerms(); render();
    });
  }

  // ================= PRICES TAB =================
  function renderPriceBits() {
    const { p, src } = priceUSD();
    const fx = fxRate();
    // chips on the compare tab
    $("#priceChips").innerHTML = METALS.map((m) => {
      const v = m === "cu" ? p[m] * 1000 : p[m] * TOZ;
      return `<span class="pchip${src[m] === "manual" ? " manual" : ""}"><b>${MN[m]}</b> ${isFinite(v) ? "$" + f0(v) : "–"}<i>${m === "cu" ? "/t" : "/oz"}</i></span>`;
    }).join("") + `<span class="pchip${fxCfg.mode === "manual" ? " manual" : ""}"><b>EUR/USD</b> ${isFinite(fx) ? fN(fx, 4) : "–"}</span>`;
    $("#fxNow").textContent = isFinite(fx) ? fN(fx, 5) + (fxCfg.mode === "manual" ? " (manual)" : " (live)") : "–";
  }
  function renderPriceList() {
    const fx = fxRate();
    $("#priceList").innerHTML = METALS.map((m) => {
      const live = last.usd[m];
      const liveDisp = m === "cu" ? live * 1000 : live * TOZ;
      const eurKg = isFinite(live) && fx ? (m === "cu" ? live : live * 1000) / fx : NaN;
      return `<div class="prow">
        <div class="pm"><b>${MN[m]}</b> ${FULL[m]}</div>
        <div class="pv"><span>Live bid</span><b>${isFinite(liveDisp) ? "$" + f2(liveDisp) : "–"}</b><i>${m === "cu" ? "USD/t" : "USD/oz"}</i></div>
        <div class="pv"><span>≈ EUR/kg</span><b>${isFinite(eurKg) ? "€" + f2(eurKg) : "–"}</b></div>
        <label class="pv po"><span>Manual</span><input data-ovr="${m}" type="number" step="any" inputmode="decimal" placeholder="live" value="${overrides[m] ?? ""}"><i>${m === "cu" ? "USD/t" : "USD/oz"}</i></label>
      </div>`;
    }).join("");
    $$("[data-ovr]").forEach((el) => el.addEventListener("change", () => {
      if (el.value === "") delete overrides[el.dataset.ovr]; else overrides[el.dataset.ovr] = num(el.value);
      save(K.ovr, overrides); render();
    }));
    $("#fxMode").value = fxCfg.mode;
    $("#fxManual").value = fxCfg.manual;
  }
  $("#fxMode").addEventListener("change", (e) => { fxCfg.mode = e.target.value; save(K.fx, fxCfg); renderPriceList(); render(); });
  $("#fxManual").addEventListener("change", (e) => { fxCfg.manual = num(e.target.value); save(K.fx, fxCfg); render(); });

  async function fetchPrices() {
    const q = `{
      au: GetMetalQuoteV3(symbol: "AU", currency: "USD") { results { bid originalTime } }
      ag: GetMetalQuoteV3(symbol: "AG", currency: "USD") { results { bid } }
      pd: GetMetalQuoteV3(symbol: "PD", currency: "USD") { results { bid } }
      pt: GetMetalQuoteV3(symbol: "PT", currency: "USD") { results { bid } }
      cu: GetMetalQuote(symbol: "CU", currency: "USD") { results { bid unit } }
      aueur: GetMetalQuoteV3(symbol: "AU", currency: "EUR") { results { bid } }
    }`;
    setStatus("", "Updating…");
    try {
      const res = await fetch(KITCO_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const d = (await res.json()).data || {};
      const bid = (k) => d[k] && d[k].results && d[k].results[0] && d[k].results[0].bid;
      const usd = {};
      ["au", "ag", "pd", "pt"].forEach((m) => { const b = bid(m); if (isFinite(b) && b > 0) usd[m] = b / TOZ; });   // USD/oz → USD/g
      const cu = bid("cu"); if (isFinite(cu) && cu > 0) usd.cu = cu * 2.2046226218;                            // USD/lb → USD/kg
      const ae = bid("aueur");
      const fx = isFinite(ae) && ae > 0 && usd.au ? bid("au") / ae : last.fx;
      last = { usd: Object.assign({}, last.usd, usd), fx, time: (d.au && d.au.results[0] && d.au.results[0].originalTime) || new Date().toISOString() };
      save(K.last, last);
      setStatus("ok", "Kitco bid · " + stamp(last.time));
    } catch (err) {
      setStatus("err", last.time ? "Update failed — using prices from " + stamp(last.time) : "Could not load prices (" + err.message + ")");
    }
    renderPriceList();
    render();
  }
  function setStatus(cls, txt) {
    ["#priceDot", "#priceDot2"].forEach((s) => ($(s).className = "dot " + cls));
    ["#priceStatus", "#priceStatus2"].forEach((s) => ($(s).textContent = txt));
  }
  function stamp(iso) {
    const t = new Date(iso);
    return isNaN(t) ? "" : t.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  $("#btnRefresh").addEventListener("click", fetchPrices);


  // ================= ANALYSIS LIBRARY =================
  // stored in g/t (Au, Ag, Pd, Pt) and Cu in %; the UI shows g/kg like the analysis sheet
  const SEED = [
    ["Gold Ram Memory", 0.85, 1.2, 0.035, 0.24], ["Silver Ram Memory", 0.41, 2.5, 0.23, 0.17],
    ["hdd boards mixt", 0.438, 0.621, 0.02, 0.26], ["Laptop boards 2 Bga", 0.512, 1.78, 0.049, 0.29],
    ["Only plastic cpu", 0.932, 0.16, 0.021, 0.29], ["INTEL i486 DX ceramic cpu", 9.85, 2.39, 0, 0.005],
    ["cpu with metal back with pins", 0.45, 0.05, 0.015, 0.8], ["AMD K6 ceramic cpu", 1.32, 6.13, 0.056, 0.19],
    ["Laptop boards 1 Bga", 0.351, 1.84, 0.016, 0.29], ["Old full phones no battery", 0.26, 1.3, 0.003, 0.11],
    ["Smartphones without battery", 0.13, 0.75, 0.011, 0.09], ["Vga Cards with bga", 0.392, 0.958, 0.03, 0.22],
    ["Vga cards Without Bga", 0.106, 0.668, 0.016, 0.19], ["laptop wi-fi Mix", 0.918, 3.1, 0.07, 0.3],
    ["2 bga NG boards", 0.168, 0.38, 0.003, 0.21], ["1 Bga NG boards", 0.095, 0.545, 0.005, 0.21],
    ["1 Bga with metal socket NG boards", 0.085, 0.82, 0.005, 0.22], ["Old generation 1-8 boards", 0.186, 0.683, 0.036, 0.21],
    ["Old generation Mix boards", 0.178, 0.5, 0.048, 0.21], ["Class3 pw.supply boards", 0.004, 0.021, 0.002, 0.14],
  ];
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  let library = load(K.lib, null);
  if (!library) {
    library = SEED.map(([name, au, ag, pd, cu], i) => ({ id: "seed" + i, name, au: r6(au * 1000), ag: r6(ag * 1000), pd: r6(pd * 1000), pt: 0, cuPct: r6(cu * 100), notes: "" }));
    save(K.lib, library);
  }
  const saveLib = () => save(K.lib, library);
  const gkg = (gt) => fN(num(gt) / 1000, 3);
  const anSummary = (a) => `Au ${gkg(a.au)} · Ag ${gkg(a.ag)} · Pd ${gkg(a.pd)}${num(a.pt) ? " · Pt " + gkg(a.pt) : ""} · Cu ${fN(num(a.cuPct), 1)}%`;

  // ---- add / edit analysis dialog ----
  let anEditing = null, anAfterSave = null;
  function openAnalysisDialog(item, afterSave) {
    anEditing = item || null; anAfterSave = afterSave || null;
    $("#anTitle").textContent = item ? "Edit analysis" : "Add analysis";
    $("#an_name").value = item ? item.name : "";
    ["au", "ag", "pd", "pt"].forEach((m) => { $("#an_" + m).value = item && num(item[m]) ? r6(num(item[m]) / 1000) : ""; });
    $("#an_cu").value = item && num(item.cuPct) ? item.cuPct : "";
    $("#an_notes").value = item ? item.notes || "" : "";
    $("#dlgAn").showModal();
    setTimeout(() => $("#an_name").focus(), 50);
  }
  $("#dlgAn").addEventListener("close", () => {
    if ($("#dlgAn").returnValue !== "save") return;
    const name = $("#an_name").value.trim(); if (!name) return;
    const vals = { name, au: r6(num($("#an_au").value) * 1000), ag: r6(num($("#an_ag").value) * 1000), pd: r6(num($("#an_pd").value) * 1000),
      pt: r6(num($("#an_pt").value) * 1000), cuPct: num($("#an_cu").value), notes: $("#an_notes").value };
    let item;
    if (anEditing) { item = Object.assign(anEditing, vals); }
    else { item = Object.assign({ id: uid() }, vals); library.unshift(item); }
    saveLib(); renderList(); fillBuildPick();
    if (anAfterSave) anAfterSave(item);
  });
  $("#btnAddAn").addEventListener("click", () => openAnalysisDialog(null));

  // ---- analysis list dialog ----
  function renderList() {
    const q = $("#listSearch").value.trim().toLowerCase();
    const items = library.filter((a) => !q || a.name.toLowerCase().includes(q));
    $("#listCount").textContent = `${library.length} categories`;
    $("#listBody").innerHTML = items.length ? items.map((a) => `
      <div class="litem" data-id="${a.id}">
        <div class="lmain"><b>${esc(a.name)}</b><small>${anSummary(a)}${a.notes ? " · " + esc(a.notes) : ""}</small></div>
        <div class="lbtns">
          <button class="btn primary tiny" data-use="${a.id}">Use</button>
          <button class="btn ghost tiny" data-edit="${a.id}" aria-label="Edit">Edit</button>
          <button class="btn ghost tiny danger" data-delan="${a.id}" aria-label="Delete">×</button>
        </div>
      </div>`).join("") : `<p class="note pad">No analysis found.</p>`;
    $$("#listBody [data-use]").forEach((b) => b.addEventListener("click", () => useAnalysis(library.find((a) => a.id === b.dataset.use))));
    $$("#listBody [data-edit]").forEach((b) => b.addEventListener("click", () => openAnalysisDialog(library.find((a) => a.id === b.dataset.edit))));
    $$("#listBody [data-delan]").forEach((b) => b.addEventListener("click", () => {
      const a = library.find((x) => x.id === b.dataset.delan);
      if (!confirm(`Delete "${a.name}" from the analysis list?`)) return;
      library = library.filter((x) => x !== a); saveLib(); renderList(); fillBuildPick();
    }));
  }
  function useAnalysis(a) {
    const l = cur();
    if (l.parts && l.parts.length && !confirm("This lot is built from several categories. Replace it with this single analysis?")) return;
    delete l.parts;
    Object.assign(l, { au: a.au, ag: a.ag, pd: a.pd, pt: a.pt, cuPct: a.cuPct, material: a.name });
    persistLots(); loadForm(); render();
    $("#dlgList").close();
  }
  $("#btnAnList").addEventListener("click", () => { $("#listSearch").value = ""; renderList(); $("#dlgList").showModal(); });
  $("#listSearch").addEventListener("input", renderList);
  $("#listAdd").addEventListener("click", () => openAnalysisDialog(null));

  // ---- build lot (blend) ----
  let draft = [];
  const PM = ["au", "ag", "pd", "pt"];
  function blend(parts) {
    const kg = parts.reduce((s, p) => s + num(p.kg), 0);
    const out = { kg };
    PM.concat("cuPct").forEach((m) => { out[m] = kg > 0 ? parts.reduce((s, p) => s + num(p.kg) * num(p[m]), 0) / kg : 0; });
    return out;
  }
  function fillBuildPick() {
    $("#buildPick").innerHTML = `<option value="">+ Add category from list…</option>` +
      library.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
  }
  function renderBuild() {
    const total = blend(draft);
    $("#buildRows").innerHTML = draft.length ? draft.map((p, i) => `
      <div class="brow${p.manual ? " manual" : ""}">
        <div class="brow-top">
          ${p.manual ? `<input class="bname" data-pi="${i}" data-pk="name" type="text" value="${esc(p.name)}" placeholder="Name of this quantity">`
                     : `<div class="bname"><b>${esc(p.name)}</b><small>${anSummary(p)}</small></div>`}
          <label class="bkg"><input data-pi="${i}" data-pk="kg" type="number" min="0" step="any" inputmode="decimal" value="${p.kg}" placeholder="0"><i>kg</i></label>
          <button class="x" data-prm="${i}" aria-label="Remove">×</button>
        </div>
        ${p.manual ? `<div class="bassay">
            ${PM.map((m) => `<label><span>${MN[m]} g/kg</span><input data-pi="${i}" data-pk="${m}" data-gkg="1" type="number" min="0" step="any" inputmode="decimal" value="${num(p[m]) ? r6(num(p[m]) / 1000) : ""}"></label>`).join("")}
            <label><span>Cu %</span><input data-pi="${i}" data-pk="cuPct" type="number" min="0" step="any" inputmode="decimal" value="${num(p.cuPct) || ""}"></label>
          </div>
          <button class="btn ghost tiny" data-psave="${i}" type="button">${p.libId ? "✓ in analysis list" : "Save to analysis list"}</button>` : ""}
        <div class="bshare">${total.kg > 0 ? pctS(num(p.kg) / total.kg, 1) + " of lot" : ""}</div>
      </div>`).join("") : `<p class="note pad">Add categories from your analysis list and enter the kg for each one, or add a manual analysis for a quantity that is not in the list.</p>`;
    renderBuildSum();
    $$("#buildRows [data-pk]").forEach((el) => el.addEventListener("input", () => {
      const p = draft[+el.dataset.pi], k = el.dataset.pk;
      p[k] = k === "name" ? el.value : el.dataset.gkg ? r6(num(el.value) * 1000) : el.value;
      if (k !== "name") renderBuildSum();
      if (k === "kg") $$("#buildRows .bshare").forEach((d, j) => { const t = blend(draft).kg; d.textContent = t > 0 ? pctS(num(draft[j].kg) / t, 1) + " of lot" : ""; });
    }));
    $$("#buildRows [data-prm]").forEach((b) => b.addEventListener("click", () => { draft.splice(+b.dataset.prm, 1); renderBuild(); }));
    $$("#buildRows [data-psave]").forEach((b) => b.addEventListener("click", () => {
      const p = draft[+b.dataset.psave];
      if (!p.name.trim()) { alert("Give this analysis a name first."); return; }
      if (p.libId) return;
      const item = { id: uid(), name: p.name.trim(), au: num(p.au), ag: num(p.ag), pd: num(p.pd), pt: num(p.pt), cuPct: num(p.cuPct), notes: "" };
      library.unshift(item); saveLib(); fillBuildPick(); p.libId = item.id; renderBuild();
    }));
  }
  function renderBuildSum() {
    const t = blend(draft);
    $("#buildSum").innerHTML = `
      <div class="bsum-h"><span>Total lot</span><b>${f2(t.kg)} kg</b></div>
      <div class="bsum-g">
        ${PM.map((m) => `<div><span>${MN[m]}</span><b>${fN(t[m] / 1000, 4)}</b><small>g/kg · ${fN(t[m], 1)} g/t</small></div>`).join("")}
        <div><span>Cu</span><b>${fN(t.cuPct, 2)} %</b><small>weighted</small></div>
      </div>
      <p class="note">Weighted average: each category counts in proportion to its kg.</p>`;
  }
  $("#buildPick").addEventListener("change", (e) => {
    const a = library.find((x) => x.id === e.target.value); e.target.value = "";
    if (!a) return;
    draft.push({ libId: a.id, name: a.name, kg: "", au: a.au, ag: a.ag, pd: a.pd, pt: a.pt, cuPct: a.cuPct });
    renderBuild();
    const ins = $$("#buildRows [data-pk=kg]"); ins[ins.length - 1]?.focus();
  });
  $("#buildManual").addEventListener("click", () => {
    draft.push({ manual: true, name: "", kg: "", au: 0, ag: 0, pd: 0, pt: 0, cuPct: 0 });
    renderBuild();
    const ins = $$("#buildRows .bname"); ins[ins.length - 1]?.focus();
  });
  function applyDraft(l) {
    const parts = draft.filter((p) => num(p.kg) > 0);
    if (!parts.length) { alert("Enter the kg for at least one category."); return false; }
    l.parts = clone(parts).map((p) => Object.assign(p, { kg: num(p.kg), name: p.name || "Manual analysis" }));
    syncFromParts(l);
    return true;
  }
  function syncFromParts(l) {
    const t = blend(l.parts);
    l.grossKg = r6(t.kg);
    PM.forEach((m) => { l[m] = r6(t[m]); });
    l.cuPct = r6(t.cuPct);
    if (!l.material || l.material === "Blend") l.material = "Blend";
  }
  $("#buildApply").addEventListener("click", () => {
    if (!applyDraft(cur())) return;
    persistLots(); fillSelect(); loadForm(); render(); $("#dlgBuild").close();
  });
  $("#buildNewLot").addEventListener("click", () => {
    const l = blankLot("lot#" + (lots.length + 1));
    if (!applyDraft(l)) return;
    lots.unshift(l); currentId = l.id; persistLots(); fillSelect(); loadForm(); render(); $("#dlgBuild").close();
  });
  function openBuild() {
    const l = cur();
    draft = l.parts ? clone(l.parts) : [];
    fillBuildPick(); renderBuild(); $("#dlgBuild").showModal();
  }
  $("#btnBuild").addEventListener("click", openBuild);

  // composition box on the lot card; weight & assay are locked while a lot is built from parts
  function renderComp() {
    const l = cur(), box = $("#compBox");
    const locked = !!(l.parts && l.parts.length);
    ["grossKg", "au", "ag", "pd", "pt", "cuPct"].forEach((k) => { $("#f_" + k).readOnly = locked; $("#f_" + k).closest(".field").classList.toggle("locked", locked); });
    if (!locked) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="comp-h"><b>Lot built from ${l.parts.length} categor${l.parts.length > 1 ? "ies" : "y"}</b>
        <span><button class="btn tiny" id="compEdit" type="button">Edit</button><button class="btn tiny ghost" id="compUnlink" type="button" title="Keep the averages and type values by hand">Unlink</button></span></div>
      <ul>${l.parts.map((p) => `<li><span>${esc(p.name)}</span><b>${f0(p.kg)} kg</b></li>`).join("")}</ul>`;
    $("#compEdit").addEventListener("click", openBuild);
    $("#compUnlink").addEventListener("click", () => {
      if (!confirm("Unlink the composition? The average values stay and become editable.")) return;
      delete l.parts; persistLots(); loadForm();
    });
  }

  // close buttons inside dialogs + click on backdrop
  $$("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $$("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

  // ================= BACKUP =================
  $("#btnExport").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: 3, lots, library, terms: termsOv, overrides, fx: fxCfg, exported: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `refining-calculator-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#inImport").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const incoming = data.lots || [];
      const ids = new Set(lots.map((l) => l.id));
      incoming.forEach((l) => { if (!ids.has(l.id)) lots.push(Object.assign(blankLot(l.lot || "lot"), l)); });
      if (Array.isArray(data.library)) {
        const have = new Set(library.map((a) => a.id));
        data.library.forEach((a) => { if (!have.has(a.id)) library.push(a); });
        saveLib();
      }
      if (data.terms && confirm("The file also contains refinery terms. Load them too?")) { termsOv = data.terms; save(K.terms, termsOv); }
      persistLots(); fillSelect(); renderRefChips(); renderTerms(); render();
      alert(`Imported ${incoming.length} lots.`);
    } catch (err) { alert("Invalid file: " + err.message); }
    e.target.value = "";
  });

  // ================= TABS =================
  function switchTab(name) {
    $$(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === name));
    $$(".tabpanel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
    document.body.dataset.tab = name;
    if (name === "terms") { renderRefChips(); renderTerms(); }
    if (name === "prices") renderPriceList();
    window.scrollTo({ top: 0 });
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  // ================= INIT =================
  document.body.dataset.tab = "calc";
  fillSelect(); loadForm(); renderRefChips(); renderPriceList(); render();
  fetchPrices();
  setInterval(fetchPrices, REFRESH_MS);
})();
