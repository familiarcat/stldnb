#!/usr/bin/env node
/**
 * scripts/build-sitemap.js
 *
 * Orchestrates the full sitemap pipeline from the repo root:
 *  1) (optional) merge remote sitemaps -> scripts/sitemap-combined.xml
 *  2) generate dist/sitemap/*.mmd + dist/sitemap/graph.json + assets.json (tsx script)
 *  3) build dist/sitemap/index.html viewer (tsx script)
 *  4) sanitize Mermaid .mmd to hide placeholder grouping nodes (type/date/asset host)
 *  5) render sanitized Mermaid to SVG (overview + full)
 *
 * Run:
 *   node ./scripts/build-sitemap.js [inputXml]
 *
 * Notes:
 * - Designed to be called by npm scripts from the repo root.
 * - Uses `npx @mermaid-js/mermaid-cli` for SVG output.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function say(msg) { process.stdout.write(String(msg) + "\n"); }
function warn(msg) { process.stderr.write("⚠️  " + String(msg) + "\n"); }
function die(msg, code = 1) {
  process.stderr.write("❌ " + String(msg) + "\n");
  process.exit(code);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.error) die(res.error.message);
  if (res.status !== 0) die(`${cmd} ${args.join(" ")} failed (exit ${res.status})`, res.status ?? 1);
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

// Repo root is one level up from /scripts
const repoRoot = path.resolve(__dirname, "..");
process.chdir(repoRoot);

const inputXml = process.argv[2] || path.join(repoRoot, "scripts", "sitemap-combined.xml");

const mergeSh = path.join(repoRoot, "scripts", "merge-sitemaps-recursive.sh");
const mermaidGenTs = path.join(repoRoot, "scripts", "sitemap-to-mermaid.ts");
const viewerTs = path.join(repoRoot, "scripts", "build-sitemap-viewer.ts");

const outDir = path.join(repoRoot, "dist", "sitemap");
const indexMmd = path.join(outDir, "index.mmd");
const unifiedMmd = path.join(outDir, "unified.mmd");
const indexClean = path.join(outDir, "index.clean.mmd");
const unifiedClean = path.join(outDir, "unified.clean.mmd");
const svgOverview = path.join(outDir, "sitemap.svg");
const svgFull = path.join(outDir, "unified.svg");

say(`🧭 Repo root: ${repoRoot}`);
say(`📄 Using sitemap: ${inputXml}`);

// 1) Optional merge
if (exists(mergeSh)) {
  say("🔁 merge sitemaps…");
  run("bash", [mergeSh]);
} else {
  warn("merge script not found; skipping");
}

// Ensure input exists
if (!exists(inputXml)) {
  die(`Missing input XML: ${inputXml}\nTip: place it at scripts/sitemap-combined.xml or pass a path to build-sitemap.js`);
}

// 2) Generate MMD + graph.json + assets.json
if (!exists(mermaidGenTs)) die(`Missing: ${mermaidGenTs}`);
say("🧩 generating mermaid + graph.json…");
run("node", ["--import", "tsx", mermaidGenTs, inputXml]);

// 3) Build viewer
if (exists(viewerTs)) {
  say("🧱 building viewer…");
  run("node", ["--import", "tsx", viewerTs]);
} else {
  warn("viewer builder not found; skipping");
}

// 4) Sanitize MMD for SVG output
// Placeholder grouping nodes we keep in the data model but hide from visual outputs.
// (These are structural helpers, not actual content nodes.)
const PLACEHOLDER_LABEL_RE = /^(type:\s|date:\s|asset host:\s|category:\s)/i;

function sanitizeMermaidSource(src) {
  const lines = src.split(/\r?\n/);

  // node defs look like: id["type: blog"] or id['type: blog']
  const placeholderIds = new Set();
  for (const ln of lines) {
    const m =
      ln.match(/^\s*([A-Za-z0-9_]+)\s*\[\s*"(.*?)"\s*\]/) ||
      ln.match(/^\s*([A-Za-z0-9_]+)\s*\[\s*'(.*?)'\s*\]/);
    if (!m) continue;
    const id = m[1];
    const label = (m[2] || "").trim();
    if (PLACEHOLDER_LABEL_RE.test(label)) placeholderIds.add(id);
  }

  if (!placeholderIds.size) return src;

  const keep = [];
  for (const ln of lines) {
    // drop node defs for placeholder ids
    if ([...placeholderIds].some((id) => ln.match(new RegExp("^\\s*" + id + "\\s*\\[")))) continue;

    // drop edges/clicks involving placeholder ids
    if (
      [...placeholderIds].some(
        (id) =>
          ln.includes(" " + id + " ") ||
          ln.includes("-->" + id) ||
          ln.includes(id + "-->") ||
          ln.trim().startsWith("click " + id + " ")
      )
    ) continue;

    keep.push(ln);
  }
  return keep.join("\n");
}

function writeSanitized(inFile, outFile) {
  if (!exists(inFile)) return false;
  const src = fs.readFileSync(inFile, "utf8");
  const clean = sanitizeMermaidSource(src);
  fs.writeFileSync(outFile, clean, "utf8");
  return true;
}

if (!exists(indexMmd)) die(`Missing ${indexMmd} (generator did not run?)`);
if (!exists(unifiedMmd)) warn(`Missing ${unifiedMmd} (full SVG will be skipped)`);

say("🧼 sanitizing mermaid for SVG…");
writeSanitized(indexMmd, indexClean);
if (exists(unifiedMmd)) writeSanitized(unifiedMmd, unifiedClean);

// 5) Render SVGs (use sanitized inputs)
say("🖼  rendering SVGs…");
run("npx", ["-y", "@mermaid-js/mermaid-cli", "-i", indexClean, "-o", svgOverview]);

if (exists(unifiedClean)) {
  run("npx", ["-y", "@mermaid-js/mermaid-cli", "-i", unifiedClean, "-o", svgFull]);
} else {
  warn("unified.clean.mmd not found; skipped unified.svg");
}

say("✅ done");
say(`   viewer: ${path.join(outDir, "index.html")}`);
say(`   svg:    ${svgOverview}`);
if (exists(svgFull)) say(`   svg:    ${svgFull}`);
