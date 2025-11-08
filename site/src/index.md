---
title: Global Interest in Cosmetic Procedures
toc: false
---

# Global Interest in Cosmetic Procedures

This interactive choropleth shows worldwide search interest for **various cosmetic procedures** from **2010–2024**, based on Google Trends data.  
Use the controls below to explore changes across years and countries.

<div id="controls"></div>
<div id="headline" style="margin:0.75rem 0; text-align:center; font-weight:600;"></div>
<div id="map"></div>

```js
// --- Imports ---
import * as d3 from "d3";
import * as Plot from "@observablehq/plot";
import {feature} from "topojson-client";
import {FileAttachment} from "observablehq:stdlib";
import * as Inputs from "@observablehq/inputs";

/* ----------------------------- 0) Region utilities ----------------------------- */
// Robust name → ISO-2 resolver (handles abbreviations/diacritics) and
// avoids historical codes that collide with modern countries.
const regionNames = new Intl.DisplayNames(["en"], {type: "region"});
const DEPRECATED = new Set(["SU","YU","DY","HV","FX","ZR","BU","TP","CS","AN"]);
const ISO2 = Array.from({length: 26*26}, (_, i) =>
  String.fromCharCode(65 + (i/26|0), 65 + (i%26))
).filter(c => !DEPRECATED.has(c) && regionNames.of(c) && regionNames.of(c) !== c);
const nameToIso2 = new Map(ISO2.map(c => [regionNames.of(c), c]));

const stripDiacritics = s => s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
function norm(s) {
  return stripDiacritics(String(s||"")
    .toLowerCase()
    .replace(/&/g," and ")
    .replace(/[().,'’]/g," ")
    .replace(/\s+/g," ")
    .trim()
    .replace(/^the\s+/,""));
}
const nameToIso2Lower = new Map(Array.from(nameToIso2, ([n,c]) => [norm(n), c]));

// Hand aliases for Natural Earth / GT quirks
const REGION_ALIAS = new Map([
  // US/UK
  ["united states","US"],["united states of america","US"],["usa","US"],["u s","US"],["u s a","US"],
  ["united kingdom","GB"],["uk","GB"],["great britain","GB"],
  // France / Türkiye
  ["france","FR"],["metropolitan france","FR"],
  ["turkiye","TR"],["turkey","TR"],
  // Korea
  ["south korea","KR"],["korea republic of","KR"],
  // Russia
  ["russia","RU"],["russian federation","RU"],
  // Balkans
  ["serbia","RS"],
  ["bosnia and herzegovina","BA"],["bosnia and herz","BA"],
  ["north macedonia","MK"],["macedonia","MK"],
  // Africa (old names/abbr.)
  ["benin","BJ"],["dahomey","BJ"],
  ["burkina faso","BF"],["upper volta","BF"],
  ["western sahara","EH"],["w sahara","EH"],
  ["south sudan","SS"],["s sudan","SS"],
  ["democratic republic of the congo","CD"],["dem rep congo","CD"],["congo kinshasa","CD"],
  ["republic of the congo","CG"],["congo","CG"],["congo brazzaville","CG"],
  // SE Asia
  ["myanmar","MM"],["myanmar burma","MM"],["burma","MM"],
  // Misc.
  ["united arab emirates","AE"],["uae","AE"],
  ["czech republic","CZ"],["czechia","CZ"],
  ["ivory coast","CI"],["cote divoire","CI"],["cote d ivoire","CI"],
  ["dominican republic","DO"],["dominican rep","DO"],
  ["moldova","MD"],["laos","LA"]
]);

function iso2FromName(name) {
  if (!name) return null;
  const k = norm(name);
  if (REGION_ALIAS.has(k)) return REGION_ALIAS.get(k);
  const byDisplay = nameToIso2Lower.get(k);
  if (byDisplay) return byDisplay;
  const soft = k.replace(/\bpeople s republic of\b/g,"").replace(/\brepublic of\b/g,"")
                .replace(/\bstate of\b/g,"").replace(/\s+/g," ").trim();
  if (REGION_ALIAS.has(soft)) return REGION_ALIAS.get(soft);
  return nameToIso2Lower.get(soft) ?? null;
}

/* ----------------------------- 1) Load & shape data ----------------------------- */
// Load both merged datasets and concatenate.
// Expected columns: country, iso2, year, procedure, interest
const botox = await FileAttachment("data/botox_2010to2024.csv").csv();
const skin  = await FileAttachment("data/skin_brightening_2010to2024.csv").csv().catch(() => []);
const rhinoplasty = await FileAttachment("data/rhinoplasty_2010to2024.csv").csv().catch(() => []);

const rawAll = [...botox, ...skin, ...rhinoplasty,];

const rows = rawAll.map(d => ({
  country: d.country,
  region: d.iso2 || iso2FromName(d.country),
  year: +d.year,
  procedure: String(d.procedure || "").toLowerCase(), // "botox" or "skin_brightening"
  interest: +d.interest
})).filter(d => d.region && Number.isFinite(d.interest));

// Available procedures (in a nice order if both exist)
const PROCEDURE_LABEL = {botox: "Botox", skin_brightening: "Skin brightening", rhinoplasty: "Rhinoplasty"};
const procedures = ["botox","skin_brightening","rhinoplasty"].filter(p => rows.some(d => d.procedure === p));
const years = rows.map(d => d.year);
const yearMinGlobal = d3.min(years), yearMaxGlobal = d3.max(years);

// Regions from all data (keeps dropdown stable)
const regionsAll = Array.from(new Set(rows.map(d => d.region))).sort();
const prefer = regionsAll.includes("US") ? "US" : regionsAll[0];

/* ----------------------------- 2) UI Controls ----------------------------- */
const controlsEl = document.getElementById("controls");

const elProcedure = Inputs.select(procedures, {
  label: "Procedure",
  format: v => PROCEDURE_LABEL[v] ?? v,
  value: procedures[0]
});
const elYearStart = Inputs.range([yearMinGlobal, yearMaxGlobal], {label: "Start year", value: 2015, step: 1});
const elYearEnd   = Inputs.range([yearMinGlobal, yearMaxGlobal], {label: "End year", value: 2024, step: 1});
const elRegion    = Inputs.select(regionsAll, {label: "Selected country", value: prefer});

const elMsg = document.createElement("div");
elMsg.style.margin = "0.25rem 0 0.5rem";
elMsg.style.fontSize = "12px";
elMsg.style.color = "var(--theme-red, #b91c1c)";
elMsg.style.display = "none";

controlsEl.append(elProcedure, elYearStart, elYearEnd, elRegion, elMsg);

// Keep yearEnd ≥ yearStart
const startSlider = elYearStart.querySelector('input[type="range"]');
const endSlider   = elYearEnd.querySelector('input[type="range"]');
function showError(msg) {
  elMsg.textContent = msg;
  elMsg.style.display = "";
  clearTimeout(showError._t);
  showError._t = setTimeout(() => elMsg.style.display = "none", 2000);
}
function syncYearBounds() {
  if (endSlider) endSlider.min = String(elYearStart.value);
  if (+elYearEnd.value < +elYearStart.value) elYearEnd.value = elYearStart.value;
}
elYearStart.addEventListener("input", () => { elYearEnd.value = elYearStart.value; syncYearBounds(); update(); });
elYearEnd.addEventListener("input", () => {
  if (+elYearEnd.value < +elYearStart.value) { elYearEnd.value = elYearStart.value; syncYearBounds(); showError("End year must not be before start year."); }
  update();
});
syncYearBounds();

/* ----------------------------- 3) Data helpers ----------------------------- */
function filteredRows(s) {
  const y0 = Math.min(s.yearStart, s.yearEnd);
  const y1 = Math.max(s.yearStart, s.yearEnd);
  return rows.filter(d => d.procedure === s.procedure && d.year >= y0 && d.year <= y1);
}
function aggByRegion(data) {
  const by = d3.group(data, d => d.region);
  return Array.from(by, ([region, arr]) => ({region, mean: d3.mean(arr, d => d.interest)}));
}

/* ----------------------------- 4) Map Renderer ----------------------------- */
const headlineEl = document.getElementById("headline");
const mapEl = document.getElementById("map");
const world = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
const countries = feature(world, world.objects.countries).features;

function dateSpan(y0, y1) { return `(Jan 1 ${y0} – Dec 31 ${y1})`; }
function renderHeadline(s) {
  const label = regionNames.of(s.region) || s.region;
  const y0 = Math.min(s.yearStart, s.yearEnd);
  const y1 = Math.max(s.yearStart, s.yearEnd);
  headlineEl.innerHTML = `<b>${label}</b> · ${PROCEDURE_LABEL[s.procedure] ?? s.procedure} · ${y0}–${y1} 
    <span style="color:var(--theme-foreground-muted)">${dateSpan(y0, y1)}</span>`;
}

function renderMap(s, data) {
  mapEl.innerHTML = "";

  const agg = aggByRegion(data);
  const valueByIso2 = new Map(agg.map(d => [d.region, d.mean]));
  const domain = [0, 100];
  const color = d3.scaleSequential(d3.interpolateYlGnBu).domain(domain);

  const width = Math.min(1400, mapEl.clientWidth || 960);
  const height = Math.round(width * 0.52);
  const projection = d3.geoNaturalEarth1().fitSize([width, height], {type: "Sphere"});
  const path = d3.geoPath(projection);

  const svg = d3.create("svg").attr("width", width).attr("height", height);
  svg.append("rect").attr("width", width).attr("height", height).attr("fill", "#f8fafc");

  svg.append("g")
    .selectAll("path")
    .data(countries)
    .join("path")
    .attr("d", path)
    .attr("fill", d => {
      const code = iso2FromName(d.properties.name);
      const v = code ? valueByIso2.get(code) : undefined;
      return Number.isFinite(v) ? color(v) : "#e5e7eb";
    })
    .attr("stroke", "#fff")
    .attr("stroke-width", 0.5)
    .on("click", (event, d) => {
      const code = iso2FromName(d.properties.name);
      if (code) { elRegion.value = code; update(); }
    })
    .append("title")
    .text(d => {
      const code = iso2FromName(d.properties.name);
      const v = code ? valueByIso2.get(code) : undefined;
      return `${d.properties.name} (${code ?? "—"})\nInterest: ${Number.isFinite(v) ? Math.round(v) : "n/a"}`;
    });

  const legend = Plot.legend({color: {type: "sequential", scheme: "ylgnbu", domain}, label: "Search interest (0–100)"});
  const nodata = document.createElement("div");
  nodata.style.fontSize = "12px";
  nodata.style.marginTop = "4px";
  nodata.innerHTML = `<span style="display:inline-block;width:12px;height:12px;background:#e5e7eb;border:1px solid #d1d5db;margin-right:6px;vertical-align:middle;"></span> Gray = No data`;

  const wrap = document.createElement("div");
  wrap.appendChild(svg.node());
  wrap.appendChild(legend);
  wrap.appendChild(nodata);
  mapEl.appendChild(wrap);
}

/* ----------------------------- 5) State & Update ----------------------------- */
function state() {
  return {
    procedure: elProcedure.value,
    yearStart: +elYearStart.value,
    yearEnd: +elYearEnd.value,
    region: elRegion.value
  };
}
function update() {
  const s = state();
  const data = filteredRows(s);
  renderHeadline(s);
  renderMap(s, data);
}
[elProcedure, elRegion].forEach(el => el.addEventListener("input", update));
window.addEventListener("resize", update);
update();
