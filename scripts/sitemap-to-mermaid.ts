#!/usr/bin/env node
/**
 * Generate drillable Mermaid + graph.json from a combined sitemap XML.
 *
 * Run:
 *   node --import tsx ./scripts/sitemap-to-mermaid.ts ./scripts/sitemap-combined.xml
 *
 * Adds (Dec 2025):
 *  - Exclude "category" taxonomy placeholder nodes from ALL outputs (Mermaid + graph.json).
 *    By default excludes URLs containing '/category/' (and '/product-category/').
 *    Override with:
 *      --exclude=/category/,/product-category/
 */
import fs from "node:fs";
import path from "node:path";

type Entry = { loc: string; images: string[] };

const inputFile = process.argv[2] ?? "./scripts/sitemap-combined.xml";
const OUT_DIR = "./dist/sitemap";
const SECTIONS_DIR = path.join(OUT_DIR, "sections");

const MAX_IMAGES = getInt("--max-images", 3);
const GROUP_DEPTH = Math.max(1, getInt("--group-depth", 1)); // for index grouping
const SECTION_DEPTH = Math.max(1, getInt("--section-depth", 3)); // depth inside section

// Exclude patterns (comma-separated substrings). Defaults remove taxonomy category placeholders.
const EXCLUDE = getList("--exclude", ["/category/", "/product-category/"]);

function getInt(flag: string, def: number): number {
  const p = process.argv.find((a) => a.startsWith(flag + "="));
  if (!p) return def;
  const v = Number(p.split("=").slice(1).join("="));
  return Number.isFinite(v) ? v : def;
}
function getList(flag: string, def: string[]): string[] {
  const p = process.argv.find((a) => a.startsWith(flag + "="));
  if (!p) return def;
  const raw = p.split("=").slice(1).join("=").trim();
  if (!raw) return def;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function hash8(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).slice(0, 8);
}

function safeId(s: string): string {
  const base =
    "n_" +
    s
      .replace(/^https?:\/\//, "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  return `${base}_${hash8(s)}`;
}

function mmdEscape(s: string): string {
  return s
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .replace(/"/g, "'")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .trim();
}

function clickUrlEscape(u: string): string {
  return u.replace(/"/g, "%22").replace(/\r?\n|\r/g, "");
}

function titleFromUrl(u: string): string {
  try {
    const url = new URL(u);
    const pathn = url.pathname.replace(/\/+$/, "");
    if (!pathn || pathn === "") return "Home";
    const parts = pathn.split("/").filter(Boolean);
    const last = parts.at(-1) ?? "Page";
    return decodeURIComponent(last).replace(/-/g, " ");
  } catch {
    return u;
  }
}

function pathParts(u: string): string[] {
  try {
    return new URL(u).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

function groupKey(u: string, depth: number): string {
  const parts = pathParts(u);
  if (parts.length === 0) return "(root)";
  return parts.slice(0, Math.min(depth, parts.length)).join("/");
}

function sectionSlug(key: string): string {
  return (
    key
      .toLowerCase()
      .replace(/[^a-z0-9\/_-]/g, "")
      .replace(/\//g, "__")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "root"
  );
}

function isExcludedUrl(u: string): boolean {
  // Exclude patterns by substring match
  const uu = String(u || "");
  if (!uu) return true;
  return EXCLUDE.some((pat) => pat && uu.includes(pat));
}

// --- Parse XML tolerantly ---
const xml = fs.readFileSync(inputFile, "utf8");
const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];

function extractLoc(block: string): string {
  return (block.match(/<loc>([\s\S]*?)<\/loc>/)?.[1] ?? "").trim();
}

function extractImages(block: string): string[] {
  const cdata = Array.from(
    block.matchAll(/<image:loc>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/image:loc>/g)
  ).map((m) => m[1].trim());

  const plain = Array.from(
    block.matchAll(/<image:loc>\s*([^<\s][\s\S]*?)\s*<\/image:loc>/g)
  )
    .map((m) => m[1].trim())
    .filter((u) => u && !u.startsWith("<![CDATA["));

  const all = [...cdata, ...plain].filter(Boolean);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const u of all) {
    if (!seen.has(u)) {
      seen.add(u);
      deduped.push(u);
    }
  }
  return deduped;
}

let entries: Entry[] = urlBlocks
  .map((b) => ({ loc: extractLoc(b), images: extractImages(b) }))
  .filter((e) => !!e.loc)
  .filter((e) => !isExcludedUrl(e.loc)); // <-- category removal

// Determine site host
const siteHost = (() => {
  try {
    return new URL(entries[0]?.loc ?? "https://example.com").host;
  } catch {
    return "site";
  }
})();

// Group entries for index
const groups = new Map<string, Entry[]>();
for (const e of entries) {
  const key = groupKey(e.loc, GROUP_DEPTH);
  groups.set(key, [...(groups.get(key) ?? []), e]);
}
const sortedGroupKeys = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));

ensureDir(OUT_DIR);
ensureDir(SECTIONS_DIR);

// Write assets map
const assetsMap: Record<string, string[]> = {};
for (const e of entries) assetsMap[e.loc] = e.images;
fs.writeFileSync(path.join(OUT_DIR, "assets.json"), JSON.stringify(assetsMap, null, 2));

// --- Build INDEX Mermaid ---
let index = "";
index += `%%{init: {"securityLevel":"loose"}}%%\n`;
index += `flowchart TD\n`;
const rootId = "site_root";
index += `  ${rootId}["${mmdEscape(siteHost)}"]:::root\n`;
index += `  legend["Legend: solid = pages • dashed = image assets • click section to drill down"]:::legend\n`;
index += `  ${rootId} --> legend\n`;

for (const key of sortedGroupKeys) {
  const segId = safeId(`seg_${key}`);
  const slug = sectionSlug(key);
  index += `  ${segId}["${mmdEscape(key)}"]:::section\n`;
  index += `  ${rootId} --> ${segId}\n`;
  index += `  click ${segId} "sections/${slug}.html"\n`;
}

index += `\n`;
index += `  classDef root font-weight:bold,stroke-width:2px,stroke:#333,fill:#ffffff;\n`;
index += `  classDef section font-weight:bold,stroke:#555,fill:#f3f3f3;\n`;
index += `  classDef legend stroke:#bbb,fill:#fff;\n`;

fs.writeFileSync(path.join(OUT_DIR, "index.mmd"), index);

// --- Build SECTION graphs ---
for (const key of sortedGroupKeys) {
  const slug = sectionSlug(key);
  const list = (groups.get(key) ?? []).slice().sort((a, b) => a.loc.localeCompare(b.loc));

  const sectionRootId = "section_root";
  let mmd = "";
  mmd += `%%{init: {"securityLevel":"loose"}}%%\n`;
  mmd += `flowchart TD\n`;
  mmd += `  ${sectionRootId}["${mmdEscape(siteHost)} / ${mmdEscape(key)}"]:::root\n`;

  const upId = "up_index";
  mmd += `  ${upId}["⬅ Back to Index"]:::nav\n`;
  mmd += `  ${sectionRootId} --> ${upId}\n`;
  mmd += `  click ${upId} "../index.html"\n`;

  const pathNodeId = new Map<string, string>();
  function ensurePathNode(parts: string[]) {
    const pk = parts.join("/");
    if (pathNodeId.has(pk)) return pathNodeId.get(pk)!;
    const nid = safeId(`path_${key}_${pk}`);
    pathNodeId.set(pk, nid);
    const label = parts.at(-1) ?? pk;
    if (parts.length === 1) {
      mmd += `  ${nid}["${mmdEscape(label)}"]:::subsection\n`;
      mmd += `  ${sectionRootId} --> ${nid}\n`;
    } else {
      const parentKey = parts.slice(0, -1).join("/");
      const parentId = pathNodeId.get(parentKey) ?? sectionRootId;
      mmd += `  ${nid}["${mmdEscape(label)}"]:::subsection\n`;
      mmd += `  ${parentId} --> ${nid}\n`;
    }
    return nid;
  }

  for (const e of list) {
    // category URLs already excluded globally; keep guard anyway
    if (isExcludedUrl(e.loc)) continue;

    const parts = pathParts(e.loc);
    const sectionParts = key === "(root)" ? parts : parts.slice(GROUP_DEPTH);
    const depthParts = sectionParts.slice(0, Math.min(SECTION_DEPTH, sectionParts.length));
    let parent = sectionRootId;

    if (depthParts.length > 0) {
      for (let i = 0; i < depthParts.length; i++) {
        const chain = depthParts.slice(0, i + 1);
        const node = ensurePathNode(chain);
        parent = node;
      }
    }

    const pageId = safeId(e.loc);
    mmd += `  ${pageId}["${mmdEscape(titleFromUrl(e.loc))}"]:::page\n`;
    mmd += `  ${parent} --> ${pageId}\n`;
    mmd += `  click ${pageId} "${clickUrlEscape(e.loc)}"\n`;

    e.images.slice(0, MAX_IMAGES).forEach((img, idx) => {
      const imgId = `${pageId}_img_${idx + 1}`;
      mmd += `  ${imgId}["${mmdEscape(`image ${idx + 1}`)}"]:::asset\n`;
      mmd += `  ${pageId} --> ${imgId}\n`;
      mmd += `  click ${imgId} "${clickUrlEscape(img)}"\n`;
    });
  }

  mmd += `\n`;
  mmd += `  classDef root font-weight:bold,stroke-width:2px,stroke:#333,fill:#ffffff;\n`;
  mmd += `  classDef nav stroke:#333,fill:#fff;\n`;
  mmd += `  classDef subsection font-weight:bold,stroke:#777,fill:#fafafa;\n`;
  mmd += `  classDef page fill:#ffffff,stroke:#333,stroke-width:1px;\n`;
  mmd += `  classDef asset fill:#f9f9f9,stroke:#999,stroke-dasharray:3 3;\n`;

  fs.writeFileSync(path.join(SECTIONS_DIR, `${slug}.mmd`), mmd);
}

console.log(`✅ Wrote: ${OUT_DIR}/index.mmd and ${SECTIONS_DIR}/*.mmd and ${OUT_DIR}/assets.json (excluded: ${EXCLUDE.join(", ")})`);
