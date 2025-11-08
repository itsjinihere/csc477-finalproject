// Usage:
//   node scripts/merge-trends.js botox ./src/data/botox ./src/data/botox_2010to2024.csv
//
// Args:
//   1) <procedure>   e.g., "botox" (string used to find the value column in each CSV)
//   2) <inputDir>    directory containing yearly CSVs like botox_2010.csv ... botox_2024.csv
//   3) <outputCsv>   path to write the merged tidy CSV
//
// Output columns:
//   country,iso2,year,procedure,interest
//
// Requires:
//   npm i i18n-iso-countries d3-dsv
//
// Notes:
// - Resolves ISO2 for ~all official countries via ISO-3166; EXTRA maps common GT quirks/territories.
// - Logs unresolved names so you can add one-time fixes to EXTRA if needed.

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import {csvParse, csvFormat} from "d3-dsv";
import countries from "i18n-iso-countries";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const en = require("i18n-iso-countries/langs/en.json");
countries.registerLocale(en);

// One-time aliases for Google Trends quirks, alt spellings, and territories.
// If the console warns about an unresolved name, add it here once.
const EXTRA = new Map([
  ["u.s.", "US"], ["usa", "US"], ["united states of america", "US"],
  ["great britain", "GB"], ["u.k.", "GB"], ["uk", "GB"],
  ["russian federation", "RU"],
  ["south korea", "KR"], ["korea, republic of", "KR"],
  ["north macedonia", "MK"], ["macedonia", "MK"],
  ["czech republic", "CZ"], ["czechia", "CZ"],
  ["ivory coast", "CI"], ["côte d’ivoire", "CI"], ["cote d'ivoire", "CI"], ["cote d’ivoire", "CI"],
  ["u.a.e.", "AE"], ["uae", "AE"], ["united arab emirates", "AE"],
  ["hong kong", "HK"], ["macao", "MO"], ["macau", "MO"],
  ["palestine", "PS"], ["state of palestine", "PS"],
  ["taiwan", "TW"],

  // Territories often listed by GT; roll them up to parent so your world topojson can color them.
  ["guam", "US"], ["puerto rico", "US"], ["u.s. virgin islands", "US"], ["american samoa", "US"],
  ["bermuda", "GB"], ["jersey", "GB"], ["guernsey", "GB"], ["isle of man", "GB"],
  ["cayman islands", "GB"], ["gibraltar", "GB"],
  ["curaçao", "NL"], ["curacao", "NL"], ["aruba", "NL"], ["sint maarten", "NL"],
  ["greenland", "DK"], ["faroe islands", "DK"],
  ["french guiana", "FR"], ["reunion", "FR"], ["martinique", "FR"], ["guadeloupe", "FR"],
  ["new caledonia", "FR"], ["mayotte", "FR"],

  // --- Unresolved from your run ---
  ["antigua & barbuda", "AG"],           // sovereign (ampersand quirk)
  ["bosnia & herzegovina", "BA"],        // sovereign (ampersand quirk)
  ["brunei", "BN"],                       // official: Brunei Darussalam
  ["caribbean netherlands", "NL"],        // ISO BQ (Bonaire, Saba, St. Eustatius) → roll up to NL
  ["congo - brazzaville", "CG"],          // Republic of the Congo
  ["congo - kinshasa", "CD"],             // Democratic Republic of the Congo
  ["laos", "LA"],                         // Lao PDR
  ["moldova", "MD"],
  ["réunion", "FR"],                      // ISO RE (French territory) → roll up to FR
  ["reunion", "FR"],                      // non-accent fallback
  ["st. barthélemy", "FR"],               // ISO BL → roll up to FR
  ["st. kitts & nevis", "KN"],
  ["st. lucia", "LC"],
  ["st. martin", "FR"],                   // ambiguous; use FR (French Collectivity MF) to roll up
  ["st. vincent & grenadines", "VC"],
  ["st. helena", "GB"],                   // ISO SH → roll up to GB (UK)
  ["british virgin islands", "GB"],       // ISO VG → roll up to GB
  ["turks & caicos islands", "GB"],       // ISO TC → roll up to GB
  ["trinidad & tobago", "TT"],
  ["syria", "SY"]
]);

function toISO2(name) {
  if (!name) return null;
  const norm = String(name).trim();

  // Try official name directly
  let code = countries.getAlpha2Code(norm, "en");
  if (code) return code;

  // Lowercased + basic cleanup, try EXTRA, then try again after stripping punctuation/phrases
  const lower = norm.toLowerCase();
  if (EXTRA.has(lower)) return EXTRA.get(lower);

  // Normalize quotes, drop parentheticals, dots, leading "the "
  const cleaned = lower
    .replace(/[’]/g, "'")
    .replace(/ \(.*?\)/g, "")
    .replace(/\./g, "")
    .replace(/\bthe\s+/g, "");

  if (EXTRA.has(cleaned)) return EXTRA.get(cleaned);

  // Try with capitalization restored after cleanup
  const titled = cleaned.replace(/\b\w/g, m => m.toUpperCase());
  code = countries.getAlpha2Code(titled, "en");
  if (code) return code;

  // As-is cleaned lower
  code = countries.getAlpha2Code(cleaned, "en");
  return code || null;
}

function parseInterest(x) {
  // Google Trends sometimes emits strings like "<1"
  if (x == null) return NaN;
  const s = String(x).trim();
  if (s === "") return NaN;
  const m = s.match(/[\d.]+/);
  return m ? Number(m[0]) : NaN;
}

// ---- CLI args
const [,, procedure, inDir, outFile] = process.argv;
if (!procedure || !inDir || !outFile) {
  console.error("Usage: node scripts/merge-trends.js <procedure> <inputDir> <outputCsv>");
  process.exit(1);
}

// ---- Read & merge yearly CSVs
const files = fs.readdirSync(inDir)
  .filter(f => f.toLowerCase().endsWith(".csv"))
  .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

if (!files.length) {
  console.error(`No CSV files found in ${inDir}`);
  process.exit(1);
}

const rows = [];
const unknown = new Set();

for (const file of files) {
  const year = Number(file.match(/(\d{4})/)?.[1]);
  if (!Number.isFinite(year)) {
    console.warn(`Skipping ${file} (no 4-digit year in filename).`);
    continue;
  }

  let txt = fs.readFileSync(path.join(inDir, file), "utf8");

  // Some GT CSVs have a preface; keep from the header "Country," onward.
  const anchor = txt.indexOf("\nCountry,");
  if (anchor >= 0) txt = txt.slice(anchor + 1);

  const data = csvParse(txt);
  if (!data.length) continue;

  // Find the column that contains the interest numbers (e.g., "botox: (2010)")
  const interestCol = Object.keys(data[0]).find(c => c.toLowerCase().includes(procedure.toLowerCase()));
  if (!interestCol) {
    console.warn(`No interest column containing "${procedure}" in ${file}; columns: ${Object.keys(data[0]).join(", ")}`);
    continue;
  }

  for (const r of data) {
    const country = (r["Country"] || r["country"] || "").trim();
    const v = parseInterest(r[interestCol]);
    if (!country || !Number.isFinite(v)) continue;

    const iso2 = toISO2(country);
    if (!iso2) unknown.add(country);

    rows.push({
      country,
      iso2,
      year,
      procedure,
      interest: v
    });
  }
}

// ---- Write output
fs.writeFileSync(outFile, csvFormat(rows), "utf8");
console.log(`Wrote ${rows.length} rows → ${outFile}`);

if (unknown.size) {
  console.warn("\nUnresolved names (add to EXTRA if you want them mapped):");
  console.warn(Array.from(unknown).sort().join(", "));
} else {
  console.log("All country names resolved to ISO2 ✅");
}
