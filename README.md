# Refining Calculator

Calculator pentru analizele la plăci electronice (Au, Ag, Pt, Pd, Rh, Cu), cu prețuri live de la Kitco (coloana **Bid**, în **€/kg**).

**Site:** https://adriancu91.github.io/reffining_calculator/

## Ce face
- Introduci lotul, cantitatea (kg) și analiza (g/t pentru metale prețioase, % pentru Cu).
- Calculează metalul total, metalul plătibil (yield / deducție minimă), valoarea, refining charge, treatment, sampling și **Total amount**.
- Analizele se salvează automat în browser; le poți selecta, duplica, șterge, exporta/importa (.json).
- Regulile de calcul (din fișierul Excel) se pot modifica din tab-ul **Reguli de calcul**.

## Formule
- Deducție = max(analiză × (1 − Yield), Min. deduction)
- Analiză plătibilă = max(0, analiză − deducție) × Metal payment %
- Valoare = metal plătibil (kg) × preț Kitco bid (€/kg)
- Refining charge = metal plătibil × tarif (€/kg sau €/t)
- Treatment = 550 €/dmt × tone uscate; Sampling = 950 €/lot (< 10 MT) sau 650 €/lot (≥ 10 MT)
- Total = Σ valoare − Σ refining − treatment − sampling

## Prețuri
Din API-ul public folosit de kitco.com (`kdb-gw.prod.kitco.com`), monedă EUR. Aur/argint/platină/paladiu/rodiu vin în €/oz troy și se convertesc în €/kg; cuprul vine în €/lb. Actualizare automată la 60 s.

## Fișiere
- `index.html` — interfața
- `style.css` — aspectul
- `app.js` — calculele, prețurile și salvarea
