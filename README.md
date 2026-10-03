# Refining Calculator

Compares the settlement of an e-scrap / PCB lot across **7 refineries** — Asahi, Dowa, PedalPoint, Hanwa, Umicore (via Green Auto Recycling), Techemet, Aurubis — with live Kitco **Bid** prices.

**Site:** https://adriancu91.github.io/reffining_calculator/

## How to use
1. **Compare** tab: enter gross weight, moisture and assay (Au, Ag, Pd, Pt in g/t; Cu in %). Impurities (Al, Cr, Ni, As, Hg), max piece size and the small-lot exemption are under *Impurities & handling*.
2. Refineries are ranked by net settlement in EUR, with €/kg (gross weight) and return (net ÷ value of all contained metal at 100 % of the live price). Tap a refinery for the full breakdown: payable metal, every charge, net in USD/EUR, advance/prepayment info and warnings.
   - **Add analysis**: save a category (Au/Ag/Pd/Pt in g/kg, Cu %) to the analysis list.
   - **Analysis list**: search, use, edit or delete saved categories (20 categories preloaded from the analysis sheet).
   - **Build lot**: mix several categories (from the list or a manual analysis) with kg for each; the lot weight is the total and the assay is the kg-weighted average.
3. **Terms** tab: every commercial term of every refinery, editable (brackets, tiers, charges, options). Edited values are highlighted; *Reset to Excel values* restores the originals.
4. **Prices** tab: live Kitco bid (USD), manual override per metal, EUR/USD rate (live from Kitco or locked manually), backup export/import.

## Source and verification
The calculation rules come from `REFINERY_COMPARISON.xlsx`. `engine.js` reproduces every refinery sheet formula; with the workbook's own prices and FX (1.161875) the results match the Excel to the cent, and also match LibreOffice recalculations of the workbook for additional test lots (high gold, platinum, impurities, small lots, alternative options).

## Files
- `index.html`, `style.css` — interface
- `engine.js` — refinery calculation engine (all terms + formulas)
- `app.js` — lots, comparison, terms editor, Kitco prices, saving
