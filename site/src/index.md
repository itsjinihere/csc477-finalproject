---
title: Global Interest in Cosmetic Procedures
toc: false
---

<link rel="stylesheet" href="./style.css">


# Global Interest in Cosmetic Procedures

This interactive choropleth shows worldwide search interest for **various cosmetic procedures** from **2010–2024**, based on Google Trends data.  
Use the controls below to explore changes across years and countries.


<div id="controls"></div>
<div id="headline" style="margin:0.75rem 0; font-weight:600;"></div>

<!-- Map + context side by side -->
<div id="viz-row" style="
  display:flex;
  gap:1.5rem;
  align-items:center;
  margin-top:0.5rem;
">
  <!-- Map takes most of the width -->
  <div id="map" style="flex:1 1 auto; min-width:0;"></div>

  <!-- Context panel on the right -->
  <aside id="context-panel" style="
  flex:0 0 320px;
  max-width:340px;
  max-height:70vh;      /* don't let it be taller than ~70% of viewport */
  overflow-y:auto;      /* scroll inside if content is long */
  font-size:0.9rem;
  padding:0.5rem 0.75rem;
  line-height:1.45;
  align-self:center;    /* make sure this panel is centered in the row */
"></aside>

</div>





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
const events = await FileAttachment("data/events.json").json().catch(() => []);


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

const elYear = Inputs.range([yearMinGlobal, yearMaxGlobal], {
  label: "Year",
  value: 2015,
  step: 1
});

//const elRegion = Inputs.select(regionsAll, {
  //label: "Selected country",
  //value: prefer
//});

const elMsg = document.createElement("div");
elMsg.style.margin = "0.25rem 0 0.5rem";
elMsg.style.fontSize = "12px";
elMsg.style.color = "var(--theme-red, #b91c1c)";
elMsg.style.display = "none";

controlsEl.append(elProcedure, elYear, elMsg);



/* ----------------------------- 3) Data helpers ----------------------------- */
function filteredRows(s) {
  return rows.filter(d =>
    d.procedure === s.procedure &&
    d.year === s.year
  );
}

function aggByRegion(data) {
  const by = d3.group(data, d => d.region);
  return Array.from(by, ([region, arr]) => ({region, mean: d3.mean(arr, d => d.interest)}));
}

function eventsForYearAndProcedure(proc, year) {
  return events.filter(e =>
    e.procedure === proc &&
    (
      e.year === year ||      // normal year-specific events
      e.year === "ALL" ||     // global events for all years
      e.year === null ||      // optional: allow null
      e.year === undefined    // optional: allow missing year
    )
  );
}




/* ----------------------------- 4) Map Renderer ----------------------------- */
const headlineEl = document.getElementById("headline");
const mapEl = document.getElementById("map");
const contextEl = document.getElementById("context-panel");
const world = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
const countries = feature(world, world.objects.countries).features;

function dateSpan(y0, y1) { return `(Jan 1 ${y0} – Dec 31 ${y1})`; }
function renderHeadline(s) {
  const year = s.year;
  const procLabel = PROCEDURE_LABEL[s.procedure] ?? s.procedure;
  headlineEl.innerHTML = `
    <b>${procLabel}</b> · ${year}
    <span style="color:var(--theme-foreground-muted)">(Jan 1 ${year} – Dec 31 ${year})</span>
  `;
}


function renderContext(s) {
  const all = eventsForYearAndProcedure(s.procedure, s.year);

  if (!all.length) {
    contextEl.innerHTML = "";

    return;
  }

  const procLabel = PROCEDURE_LABEL[s.procedure] ?? s.procedure;

  // Split into global vs country-specific
  const globalEvents = all.filter(e => e.region === "GLOBAL" || !e.region);
  const localEvents  = all.filter(e => e.region && e.region !== "GLOBAL");

  // Group local events by ISO2 region code
  const byRegion = d3.group(localEvents, e => e.region);

  const globalListHtml = globalEvents.length
    ? `
      <ul style="list-style:disc; padding-left:1.2rem; line-height:1.5; margin:0;">
        ${globalEvents.map(e => `
          <li style="margin-bottom:0.5rem;">
            <span style="font-weight:600;">${e.title}</span><br/>
            <span style="color:#e5e7eb; font-size:0.9rem;">${e.summary}</span>
          </li>
        `).join("")}
      </ul>
    `
    : `
      <div style="color:#9ca3af; font-size:0.9rem; margin-bottom:0.5rem;">
        No global annotated events for <b>${procLabel}</b> in <b>${s.year}</b>.
        Check the country dropdowns below for more context.
      </div>
    `;

  const localDetailsHtml = byRegion.size
    ? Array.from(byRegion, ([code, evts]) => {
        const label = regionNames.of(code) || code;
        const items = evts.map(e => `
          <li style="margin-bottom:0.5rem;">
            <span style="font-weight:600;">${e.title}</span><br/>
            <span style="color:#e5e7eb; font-size:0.9rem;">${e.summary}</span>
          </li>
        `).join("");

        return `
          <details style="
            margin-top:0.75rem;
            background:#020617;
            border:1px solid #374151;
            border-radius:0.5rem;
            padding:0.5rem 0.75rem;
          ">
            <summary style="cursor:pointer; font-weight:600;">
              More context for ${label}
            </summary>
            <ul style="list-style:disc; padding-left:1.2rem; line-height:1.5; margin-top:0.5rem;">
              ${items}
            </ul>
          </details>
        `;
      }).join("")
    : "";

  contextEl.innerHTML = `
    <h2 style="font-size:1.0rem; margin:0 0 0.5rem; text-align:left;">
      Context for ${procLabel} · ${s.year}
    </h2>
    <p style="color:#9ca3af; font-size:0.85rem; margin:0 0 0.75rem;">
      Global highlights related to changes in search interest, plus optional
      country-specific notes you can expand below.
    </p>
    ${globalListHtml}
    ${localDetailsHtml}
  `;
}




function renderMap(s, data) {
  mapEl.innerHTML = "";

  const agg = aggByRegion(data);
  const valueByIso2 = new Map(agg.map(d => [d.region, d.mean]));
  const domain = [0, 100];

  // Dark-friendly color scale
  const color = d3.scaleSequential(d3.interpolateTurbo).domain(domain);

  // Dark theme colors
  const bgColor      = "#020617"; // page / ocean
  const noDataColor  = "#111827"; // countries with no data
  const borderColor  = "#0f172a";

  const width = Math.min(1400, mapEl.clientWidth || 960);
  const height = Math.round(width * 0.52);
  const projection = d3.geoNaturalEarth1().fitSize([width, height], {type: "Sphere"});
  const path = d3.geoPath(projection);

  const svg = d3.create("svg").attr("width", width).attr("height", height);

  // Background
  svg.append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", bgColor);

  // Countries
    svg.append("g")
    .selectAll("path")
    .data(countries)
    .join("path")
    .attr("d", path)
    .attr("fill", d => {
      const code = iso2FromName(d.properties.name);
      const v = code ? valueByIso2.get(code) : undefined;
      return Number.isFinite(v) ? color(v) : noDataColor;
    })
    .attr("stroke", borderColor)
    .attr("stroke-width", 0.5)
    .append("title")
    .text(d => {
      const code = iso2FromName(d.properties.name);
      const v = code ? valueByIso2.get(code) : undefined;
      return `${d.properties.name} (${code ?? "—"})\nInterest: ${Number.isFinite(v) ? Math.round(v) : "n/a"}`;
    });


  // Legend (tweak text color for dark bg)
  const legend = Plot.legend({
    color: { type: "sequential", scheme: "turbo", domain },
    label: "Search interest (0–100)"
  });
  legend.style.color = "#e5e7eb";
  legend.style.background = "transparent";

  const nodata = document.createElement("div");
  nodata.style.fontSize = "12px";
  nodata.style.marginTop = "4px";
  nodata.style.color = "#e5e7eb";
  nodata.innerHTML = `
    <span style="
      display:inline-block;
      width:12px;height:12px;
      background:${noDataColor};
      border:1px solid #4b5563;
      margin-right:6px;
      vertical-align:middle;
    "></span>
    Gray = No data
  `;

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
    year: +elYear.value,
    //region: elRegion.value
  };
}

function update() {
  const s = state();
  const data = filteredRows(s);
  renderHeadline(s);
  renderMap(s, data);
  renderContext(s);   // NEW
}

[elProcedure, elYear].forEach(el =>
  el.addEventListener("input", update)
);


window.addEventListener("resize", update);
update();

