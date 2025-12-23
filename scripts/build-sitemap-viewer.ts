#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "./dist/sitemap";
const SECTIONS_DIR = path.join(OUT_DIR, "sections");

function ensureDir(p: string) { fs.mkdirSync(p, { recursive: true }); }
ensureDir(SECTIONS_DIR);

// Copy a simple viewer HTML into each section page
const sectionMmds = fs.readdirSync(SECTIONS_DIR).filter(f => f.endsWith(".mmd"));

const sectionHtml = (mmdFile: string) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Sitemap Section</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 0; }
    header { padding: 12px 16px; border-bottom: 1px solid #ddd; }
    #app { padding: 12px 16px; }
    .hint { color: #666; font-size: 14px; }
    .frame { border: 1px solid #eee; border-radius: 8px; padding: 10px; overflow: auto; }
  </style>
</head>
<body>
  <header>
    <div><strong>STLDNB</strong> — Drillable Sitemap</div>
    <div class="hint">Use “Back to Index” to go up. Click nodes to open destinations.</div>
  </header>
  <div id="app" class="frame">Loading…</div>

  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });

    async function render(mmdPath) {
      const res = await fetch(mmdPath);
      const text = await res.text();
      const id = "graph_" + Math.random().toString(16).slice(2);
      const { svg } = await mermaid.render(id, text);
      document.getElementById("app").innerHTML = svg;
    }

    render("./${mmdFile}");
  </script>
</body>
</html>`;

for (const mmd of sectionMmds) {
  const htmlName = mmd.replace(/\.mmd$/, ".html");
  fs.writeFileSync(path.join(SECTIONS_DIR, htmlName), sectionHtml(mmd));
}

console.log(`✅ Wrote ${sectionMmds.length} section HTML pages.`);
