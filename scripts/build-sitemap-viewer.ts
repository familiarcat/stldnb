#!/usr/bin/env node
/**
 * Build dist/sitemap/index.html viewer (Mermaid + Thought Map).
 *
 * Update:
 *  - Hide placeholder grouping nodes in BOTH Mermaid and Thought Map:
 *      "type: ...", "date: ...", "asset host: ..."
 *    These are used for categorization behind the scenes but should not be visible.
 */
import fs from "node:fs";
import path from "node:path";

const outDir = path.join("dist", "sitemap");
const vendorDir = path.join(outDir, "vendor");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(vendorDir, { recursive: true });

function tryCopy(from: string, to: string): boolean {
  try { fs.copyFileSync(from, to); return true; } catch { return false; }
}

const vendorTarget = path.join(vendorDir, "cytoscape.esm.min.js");
tryCopy(path.join("node_modules", "cytoscape", "dist", "cytoscape.esm.min.js"), vendorTarget) ||
tryCopy(path.join("node_modules", "cytoscape", "dist", "cytoscape.esm.js"), vendorTarget);

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>STLDNB Sitemap Explorer</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;}
    header{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid #e5e7eb;padding:10px 12px;}
    .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;}
    button,a.btn,input,select{padding:8px 10px;border:1px solid #d1d5db;background:#fff;border-radius:10px;}
    button{cursor:pointer;}
    a.btn{text-decoration:none;color:#111;display:inline-block;}
    .hint{color:#6b7280;font-size:13px;}
    #thoughtControls{border-top:1px solid #eef2f7;margin-top:10px;padding-top:10px;}
    #thoughtControls.hidden{display:none!important;}
    #viewport{width:100vw;height:calc(100vh - 124px);overflow:hidden;background:#fafafa;}
    #stage{transform-origin:0 0;}
    #cy{width:100%;height:100%;}
    .hidden{display:none!important;}
    #statusbar{border-top:1px solid #e5e7eb;background:#fff;padding:8px 12px;font-size:12px;color:#374151;display:flex;gap:12px;flex-wrap:wrap;align-items:center;}
    .group{display:flex;gap:8px;align-items:center;}
    label{color:#6b7280;font-size:12px;}
  </style>
</head>
<body>
<header>
  <div class="row">
    <button id="tabMermaid" aria-pressed="true">Mermaid</button>
    <button id="tabThought" aria-pressed="false">Thought Map</button>
    <button id="btnOverview">Mermaid overview</button>
    <button id="btnFull">Mermaid full</button>
    <a class="btn" href="sitemap.svg" target="_blank">SVG overview</a>
    <a class="btn" href="unified.svg" target="_blank">SVG full</a>
    <span class="hint">Drag to pan • Ctrl/Cmd+wheel zoom (Mermaid) • Wheel zoom (Thought Map)</span>
  </div>

  <div id="thoughtControls" class="row hidden" aria-hidden="true">
    <div class="group">
      <label>Thought Map display</label>
      <select id="thoughtDisplay">
        <option value="source">Source (left→right)</option>
        <option value="features">Features (focus subtree)</option>
      </select>
    </div>

    <div class="group">
      <label>Features root</label>
      <select id="featuresRoot"></select>
    </div>

    <div class="group">
      <label>Depth</label>
      <select id="featuresDepth">
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3" selected>3</option>
        <option value="4">4</option>
        <option value="5">5</option>
        <option value="6">6</option>
      </select>
    </div>

    <div class="group" id="focusOnlyWrap">
      <label style="display:flex;gap:6px;align-items:center;">
        <input id="focusOnly" type="checkbox" checked />
        Hide non-subtree
      </label>
    </div>
  </div>
</header>

<div id="viewport">
  <div id="stage"></div>
  <div id="cy" class="hidden"></div>
</div>

<div id="statusbar">
  <div class="group">Status: <span id="status">booting…</span></div>
</div>

<script type="module">
  const statusEl = document.getElementById("status");
  const setStatus = (t) => { statusEl.textContent = t; };
  const thoughtControls = document.getElementById("thoughtControls");

  const PLACEHOLDER_LABEL_RE = /^(type:\\s|date:\\s|asset host:\\s|category:\\s)/i;

  // Error overlay
  const err = document.createElement("pre");
  err.style.cssText = "position:fixed;left:12px;bottom:54px;max-width:85vw;max-height:45vh;overflow:auto;background:#111;color:#fff;padding:10px;border-radius:10px;opacity:.95;z-index:9999;display:none;white-space:pre-wrap;";
  document.body.appendChild(err);
  const showErr = (m) => { err.textContent = String(m); err.style.display = "block"; setStatus("error (see overlay)"); };
  window.addEventListener("error", (e) => showErr(e.message || e.error));
  window.addEventListener("unhandledrejection", (e) => showErr(e.reason));

  const viewport = document.getElementById("viewport");
  const stage = document.getElementById("stage");
  const cyEl = document.getElementById("cy");
  const tabMermaid = document.getElementById("tabMermaid");
  const tabThought = document.getElementById("tabThought");

  const thoughtDisplaySel = document.getElementById("thoughtDisplay");
  const featuresRootSel = document.getElementById("featuresRoot");
  const featuresDepthSel = document.getElementById("featuresDepth");
  const focusOnlyChk = document.getElementById("focusOnly");
  const focusOnlyWrap = document.getElementById("focusOnlyWrap");

  // Mermaid pan/zoom
  let scale = 1, tx = 20, ty = 20, panning = false, sx = 0, sy = 0;
  const apply = () => { stage.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")"; };
  const reset = () => { scale = 1; tx = 20; ty = 20; apply(); };

  viewport.addEventListener("mousedown", (e) => {
    if (!cyEl.classList.contains("hidden")) return;
    panning = true; sx = e.clientX - tx; sy = e.clientY - ty;
  });
  window.addEventListener("mouseup", () => { panning = false; });
  window.addEventListener("mousemove", (e) => {
    if (!panning) return;
    tx = e.clientX - sx; ty = e.clientY - sy; apply();
  });
  viewport.addEventListener("wheel", (e) => {
    if (!cyEl.classList.contains("hidden")) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    scale = Math.min(3, Math.max(0.2, scale * (e.deltaY < 0 ? 1.1 : 0.9)));
    apply();
  }, { passive:false });

  let mermaid = null;
  async function loadMermaid() {
    setStatus("loading mermaid…");
    const mod = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    mermaid = mod.default || mod;
    mermaid.initialize({ startOnLoad:false, securityLevel:"loose", flowchart:{ useMaxWidth:false } });
    setStatus("mermaid ready");
  }

  async function fetchText(file) {
    const res = await fetch(file, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) throw new Error("Fetch failed " + res.status + " for " + file + "\\n\\n" + text.slice(0, 200));
    return text;
  }

  function sanitizeMermaidSrc(src) {
    const lines = src.split(/\\r?\\n/);
    const placeholderIds = new Set();

    for (const ln of lines) {
      const m = ln.match(/^\\s*([A-Za-z0-9_]+)\\s*\\[\\s*"(.*?)"\\s*\\]/) || ln.match(/^\\s*([A-Za-z0-9_]+)\\s*\\[\\s*'(.*?)'\\s*\\]/);
      if (!m) continue;
      const id = m[1];
      const label = (m[2] || "").trim();
      if (PLACEHOLDER_LABEL_RE.test(label)) placeholderIds.add(id);
    }
    if (!placeholderIds.size) return src;

    const keep = [];
    for (const ln of lines) {
      if ([...placeholderIds].some(id => ln.match(new RegExp("^\\\\s*" + id + "\\\\s*\\\\[")))) continue;
      if ([...placeholderIds].some(id => ln.includes(" " + id + " ") || ln.includes("-->" + id) || ln.includes(id + "-->") || ln.trim().startsWith("click " + id + " "))) continue;
      keep.push(ln);
    }
    return keep.join("\\n");
  }

  async function renderMmd(file) {
    try {
      if (!mermaid) await loadMermaid();
      setStatus("rendering " + file + " …");
      stage.innerHTML = "<div style='padding:14px;color:#6b7280'>Loading <code>" + file + "</code>…</div>";
      let src = await fetchText(file);
      src = sanitizeMermaidSrc(src);
      const id = "mmd_" + Math.random().toString(16).slice(2);
      const out = await mermaid.render(id, src);
      stage.innerHTML = out.svg;
      stage.querySelectorAll("a").forEach(a => a.setAttribute("target", "_blank"));
      reset();
      setStatus("rendered " + file);
    } catch (e) {
      showErr("Mermaid render failed for " + file + "\\n\\n" + e);
    }
  }

  // Thought Map
  let cy = null;

  async function loadCytoscape() {
    try {
      const mod = await import("./vendor/cytoscape.esm.min.js");
      return mod.default || mod;
    } catch (e1) {
      const urls = [
        "https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.esm.min.js",
        "https://cdn.jsdelivr.net/npm/cytoscape@3.30.2/dist/cytoscape.esm.min.js",
        "https://esm.sh/cytoscape@3.30.2"
      ];
      for (const u of urls) { try { const mod = await import(u); return mod.default || mod; } catch {} }
      throw e1;
    }
  }

  function cssEscape(id) {
    return (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  }

  function isPlaceholderNode(n) {
    const label = String(n.data("label") || "");
    return PLACEHOLDER_LABEL_RE.test(label);
  }

  function layoutSource(rootId) {
    if (!cy) return;
    setStatus("layout: source");
    // Show the full graph (no filtering).
    cy.elements().removeClass("dim").removeClass("hiddenEl");
    cy.batch(() => {
      cy.nodes().forEach(n => { n.data("size", 54); n.data("fsize", 10); });
    });
    cy.layout({
      name: "breadthfirst",
      directed: true,
      spacingFactor: 1.45,
      animate: true,
      fit: true,
      padding: 70,
      orientation: "horizontal",
      roots: rootId ? "#" + cssEscape(rootId) : undefined
    }).run();
  }

  function bfsUndirectedWithDepth(rootId, maxDepth) {
    const keep = new Set([rootId]);
    const depthMap = new Map([[rootId, 0]]);
    const root = cy.getElementById(rootId);
    const rootKind = String(root.data("kind") || "");

    let frontier = [rootId];
    for (let d = 0; d < maxDepth; d++) {
      const next = [];
      for (const id of frontier) {
        const n = cy.getElementById(id);
        if (!n || n.empty()) continue;
        if (isPlaceholderNode(n)) continue;

        n.connectedEdges().forEach(e => {
          const s = e.source().id();
          const t = e.target().id();
          const otherId = (s === id) ? t : s;
          const other = cy.getElementById(otherId);
          if (!other || other.empty()) return;
          if (isPlaceholderNode(other)) return;

          const otherKind = String(other.data("kind") || "");
          if (rootKind === "section" && otherKind === "site") return;
          const thisKind = String(n.data("kind") || "");
          if (thisKind === "section" && otherKind === "section" && otherId !== rootId) return;

          if (!keep.has(otherId)) {
            keep.add(otherId);
            depthMap.set(otherId, (depthMap.get(id) ?? 0) + 1);
            next.push(otherId);
          }
        });
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return { keep, depthMap };
  }

  function applyDepthScaling(keep, depthMap, rootId) {
    const BASE = 80, MIN = 26, RATIO = 0.84;
    const BASE_FONT = 12, MIN_FONT = 8;

    cy.batch(() => {
      cy.nodes().forEach(n => {
        const id = n.id();
        if (!keep.has(id)) { n.data("size", 46); n.data("fsize", 9); return; }
        const d = depthMap.get(id) ?? 0;
        let sz = Math.round(BASE * Math.pow(RATIO, d));
        if (id === rootId) sz = BASE;
        if (sz < MIN) sz = MIN;

        let fs = Math.round(BASE_FONT * Math.pow(RATIO, d));
        if (id === rootId) fs = BASE_FONT;
        if (fs < MIN_FONT) fs = MIN_FONT;

        n.data("size", sz);
        n.data("fsize", fs);
      });
    });
  }

  function layoutFeatures(rootId, depth) {
    if (!cy) return;
    setStatus("layout: features");

    const { keep, depthMap } = bfsUndirectedWithDepth(rootId, depth);

    // Two modes:
    // - Focus-only: hide everything outside the chosen subtree.
    // - Context: keep the full graph but dim everything outside the subtree.
    const focusOnly = !!(focusOnlyChk && focusOnlyChk.checked);
    cy.elements().removeClass("dim").removeClass("hiddenEl");

    if (focusOnly) {
      const keepEls = cy.elements().filter(el => {
        if (el.isNode()) return keep.has(el.id());
        // edges: keep only if both endpoints are in keep
        return keep.has(el.source().id()) && keep.has(el.target().id());
      });
      cy.elements().not(keepEls).addClass("hiddenEl");
    } else {
      cy.elements().addClass("dim");
      cy.nodes().forEach(n => { if (keep.has(n.id())) n.removeClass("dim"); });
      cy.edges().forEach(e => {
        const ok = keep.has(e.source().id()) && keep.has(e.target().id());
        if (ok) e.removeClass("dim"); else e.addClass("dim");
      });
    }

    applyDepthScaling(keep, depthMap, rootId);

    const keptNodes = cy.nodes().filter(n => keep.has(n.id()));
    cy.layout({
      name: "breadthfirst",
      directed: true,
      spacingFactor: 1.35,
      animate: true,
      fit: true,
      padding: 100,
      orientation: "horizontal",
      roots: "#" + cssEscape(rootId)
    }).run();

    if (keptNodes.length) cy.fit(keptNodes, 110);
  }

  function populateFeatureRoots() {
    const site = cy.nodes("[kind='site']")[0] || cy.nodes()[0];
    if (!site) return;

    const candidates = new Map();
    const direct = site.connectedEdges().connectedNodes().filter(n => n.id() !== site.id());
    direct.forEach(n => {
      if (isPlaceholderNode(n)) return;
      const kind = String(n.data("kind") || "");
      const label = String(n.data("label") || n.id());
      if (kind === "section") candidates.set(n.id(), label);
    });

    featuresRootSel.innerHTML = "";
    Array.from(candidates.entries()).sort((a,b) => String(a[1]).localeCompare(String(b[1]))).forEach(([id,label]) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = label;
      featuresRootSel.appendChild(opt);
    });
    if (featuresRootSel.options.length) featuresRootSel.value = featuresRootSel.options[0].value;
  }

  function applyThoughtDisplay() {
    if (!cy) return;
    const site = cy.nodes("[kind='site']")[0] || cy.nodes()[0];
    const siteId = site ? site.id() : null;

    const mode = thoughtDisplaySel.value;
    // Only show the focus-only toggle in Features mode.
    if (focusOnlyWrap) focusOnlyWrap.style.display = mode === "features" ? "" : "none";
    if (mode === "source") {
      layoutSource(siteId);
    } else {
      const root = featuresRootSel.value || siteId;
      const depth = Number(featuresDepthSel.value || "3");
      if (root) layoutFeatures(root, depth);
    }
  }

  async function initThought() {
    if (cy) return;
    try {
      setStatus("loading cytoscape…");
      const cytoscape = await loadCytoscape();

      setStatus("loading graph.json…");
      const txt = await fetchText("graph.json");
      const data = JSON.parse(txt);

      // Filter out placeholder nodes/edges
      const nodes = (data.nodes || []).filter(n => {
        const label = String(n?.data?.label || "");
        return !PLACEHOLDER_LABEL_RE.test(label.trim());
      });
      const nodeSet = new Set(nodes.map(n => n.data.id));
      const edges = (data.edges || []).filter(e => nodeSet.has(e?.data?.source) && nodeSet.has(e?.data?.target));

      const elements = []
        .concat(nodes.map(n => ({ data: n.data })))
        .concat(edges.map(e => ({ data: e.data })));

      cy = cytoscape({
        container: cyEl,
        elements,
        style: [
          { selector: "node", style: {
              "label":"data(label)",
              "font-size":"data(fsize)",
              "text-wrap":"wrap",
              "text-max-width":120,
              "text-valign":"center",
              "text-halign":"center",
              "width":"data(size)",
              "height":"data(size)",
              "background-color":"#fff",
              "border-width":1,
              "border-color":"#cbd5e1",
              "shape":"round-rectangle",
              "padding":"6px"
          } },
          { selector: "node[kind='site']", style: { "border-width":2,"border-color":"#475569","background-color":"#f8fafc" } },
          { selector: "node[kind='section']", style: { "background-color":"#f1f5f9","border-color":"#64748b","font-weight":"bold" } },
          { selector: "node[kind='path']", style: { "background-color":"#eef2ff","border-color":"#818cf8" } },
          { selector: "node[kind='page']", style: { "background-color":"#ecfeff","border-color":"#06b6d4" } },
          { selector: "node[kind='image']", style: { "background-color":"#fff7ed","border-color":"#fb923c","border-style":"dashed" } },
          { selector: "node[kind='image'][img]", style: { "background-image":"data(img)","background-fit":"cover","background-opacity":0.35 } },
          { selector: "edge", style: { "width":1,"line-color":"#94a3b8","curve-style":"bezier" } },
          { selector: "edge[kind='asset']", style: { "line-style":"dashed","line-color":"#fb923c" } },
          { selector: ".dim", style: { "opacity":0.10 } },
          { selector: ".hiddenEl", style: { "display":"none" } }
        ],
        wheelSensitivity: 0.22
      });

      cy.batch(() => { cy.nodes().forEach(n => { n.data("size", 54); n.data("fsize", 10); }); });

      cy.on("tap", "node", (evt) => {
        const url = evt.target.data("url");
        if (url) window.open(url, "_blank");
      });

      populateFeatureRoots();
      applyThoughtDisplay();
      setStatus("thought map ready");
    } catch (e) {
      showErr("Thought map init failed\\n\\n" + e);
    }
  }

  function setTab(which) {
    const thought = which === "thought";
    cyEl.classList.toggle("hidden", !thought);
    stage.classList.toggle("hidden", thought);
    tabMermaid.setAttribute("aria-pressed", String(!thought));
    tabThought.setAttribute("aria-pressed", String(thought));

    thoughtControls.classList.toggle("hidden", !thought);
    thoughtControls.setAttribute("aria-hidden", String(!thought));

    if (thought) initThought();
  }

  tabMermaid.onclick = () => setTab("mermaid");
  tabThought.onclick = () => setTab("thought");
  document.getElementById("btnOverview").onclick = () => renderMmd("index.mmd");
  document.getElementById("btnFull").onclick = () => renderMmd("unified.mmd");

  thoughtDisplaySel.addEventListener("change", applyThoughtDisplay);
  featuresRootSel.addEventListener("change", applyThoughtDisplay);
  featuresDepthSel.addEventListener("change", applyThoughtDisplay);
  focusOnlyChk.addEventListener("change", applyThoughtDisplay);

  setTab("mermaid");
  renderMmd("index.mmd");
</script>
</body>
</html>`;

fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
console.log("✅ Wrote dist/sitemap/index.html (hides type/date/asset-host placeholder nodes)");