# Refining Calculator

Calculator for e-scrap / PCB assays (Au, Ag, Pt, Pd, Rh, Cu) with live Kitco prices (**Bid** column, in **€/kg**).

**Site:** https://adriancu91.github.io/reffining_calculator/

## What it does
- Enter the lot, quantity (kg) and analysis (g/t for precious metals, % for Cu).
- Calculates total metal, payable metal (yield / minimum deduction), value, refining charge, treatment, sampling and the **Total amount**.
- Analyses are saved automatically in the browser; you can select, duplicate, delete, export/import them (.json).
- The calculation rules (from the Excel file) can be edited in the **Calculation rules** tab.

## Formulas
- Deduction = max(analysis × (1 − Yield), Min. deduction)
- Payable grade = max(0, analysis − deduction) × Metal payment %
- Value = payable metal (kg) × Kitco bid price (€/kg)
- Refining charge = payable metal × rate (€/kg or €/t)
- Treatment = 550 €/dmt × dry tonnes; Sampling = 950 €/lot (< 10 MT) or 650 €/lot (≥ 10 MT)
- Total = Σ value − Σ refining − treatment − sampling

## Prices
From the public API used by kitco.com (`kdb-gw.prod.kitco.com`), currency EUR. Gold/silver/platinum/palladium/rhodium come in €/troy oz and are converted to €/kg; copper comes in €/lb. Auto-refresh every 60 s.

## Files
- `index.html` — the interface
- `style.css` — the styling
- `app.js` — calculations, prices and saving
