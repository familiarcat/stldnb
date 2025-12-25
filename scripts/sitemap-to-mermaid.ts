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

// Exclude patterns (comma-separated substrings). Empty by default - include all URLs.
const EXCLUDE = getList("--exclude", []);

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

// =============================================================================
// GRAPH.JSON GENERATION (Rich semantic graph for Thought Map)
// =============================================================================

type NodeKind =
  | 'site'        // Root site node
  | 'section'     // URL path sections (blog, shop, etc.)
  | 'category'    // WordPress categories
  | 'date'        // Date grouping (YYYY/MM)
  | 'page'        // Individual pages/posts
  | 'image'       // Asset images
  | 'type'        // Page type grouping (hidden placeholder)
  | 'asset_host'; // Asset CDN host (hidden placeholder)

interface NodeData {
  id: string;
  label: string;
  kind: NodeKind;
  url?: string;
  img?: string;
  section?: string;
  category?: string;
  date?: string;
  postType?: string;
}

type EdgeKind = 'contains' | 'page' | 'member' | 'asset' | 'related';

interface EdgeData {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
}

interface Graph {
  nodes: Array<{ data: NodeData }>;
  edges: Array<{ data: EdgeData }>;
}

interface PageMetadata {
  category?: string;
  date?: string;
  dateYear?: string;
  dateMonth?: string;
  postType: string;
  postSlug?: string;
}

function extractMetadata(url: string): PageMetadata {
  // Extract from URL path patterns
  const categoryMatch = url.match(/\/category\/([^\/]+)\/?/);
  const dateMatch = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  const postMatch = url.match(/\/blog\/\d{4}\/\d{2}\/\d{2}\/([^\/]+)\/?/);

  // Extract post type from URL structure
  let postType = 'page';
  if (url.includes('/blog/')) postType = 'post';
  if (url.includes('/product/')) postType = 'product';
  if (url.includes('/events/')) postType = 'event';
  if (url.includes('/shop/')) postType = 'product';

  return {
    category: categoryMatch?.[1]?.replace(/-/g, ' '),
    date: dateMatch ? `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}` : undefined,
    dateYear: dateMatch?.[1],
    dateMonth: dateMatch?.[2],
    postType,
    postSlug: postMatch?.[1]
  };
}

const nodes: Array<{ data: NodeData }> = [];
const edges: Array<{ data: EdgeData }> = [];
const nodeIds = new Set<string>();

function addNode(data: NodeData) {
  if (!nodeIds.has(data.id)) {
    nodes.push({ data });
    nodeIds.add(data.id);
  }
}

function addEdge(source: string, target: string, kind: EdgeKind) {
  const id = `e_${kind}_${hash8(source)}_${hash8(target)}`;
  edges.push({ data: { id, source, target, kind } });
}

// 1. Create site root
addNode({
  id: 'site',
  label: siteHost,
  kind: 'site',
  url: `https://${siteHost}`
});

// 2. Create section nodes
for (const key of sortedGroupKeys) {
  const sectionId = `sec_${safeId(key)}`;
  addNode({
    id: sectionId,
    label: key,
    kind: 'section'
  });
  addEdge('site', sectionId, 'contains');
}

// 3. Collect unique categories, dates, asset hosts
const categories = new Set<string>();
const dates = new Set<string>();
const assetHosts = new Set<string>();

for (const e of entries) {
  const metadata = extractMetadata(e.loc);

  if (metadata.category) {
    categories.add(metadata.category);
  }

  if (metadata.dateYear && metadata.dateMonth) {
    const dateKey = `${metadata.dateYear}/${metadata.dateMonth}`;
    dates.add(dateKey);
  }

  for (const img of e.images) {
    try {
      const imgHost = new URL(img).host;
      if (imgHost !== siteHost) {
        assetHosts.add(imgHost);
      }
    } catch {}
  }
}

// 4. Create grouping dimension nodes
for (const key of sortedGroupKeys) {
  const typeId = `type_${safeId(key)}`;
  addNode({
    id: typeId,
    label: `type: ${key}`,
    kind: 'type'
  });
}

for (const cat of Array.from(categories).sort()) {
  const catId = `cat_${safeId(cat)}`;
  addNode({
    id: catId,
    label: `category: ${cat}`,
    kind: 'category'
  });
}

for (const dateKey of Array.from(dates).sort()) {
  const dateId = `date_${safeId(dateKey)}`;
  addNode({
    id: dateId,
    label: `date: ${dateKey}`,
    kind: 'date'
  });
}

for (const host of Array.from(assetHosts).sort()) {
  const hostId = `assethost_${safeId(host)}`;
  addNode({
    id: hostId,
    label: `asset host: ${host}`,
    kind: 'asset_host'
  });
}

// 5. Create page and image nodes with metadata
for (const e of entries) {
  const metadata = extractMetadata(e.loc);
  const section = groupKey(e.loc, GROUP_DEPTH);
  const pageId = safeId(e.loc);

  // Page node with metadata
  addNode({
    id: pageId,
    label: titleFromUrl(e.loc),
    kind: 'page',
    url: e.loc,
    section,
    category: metadata.category,
    date: metadata.date,
    postType: metadata.postType
  });

  // Connect page to section
  const sectionId = `sec_${safeId(section)}`;
  addEdge(sectionId, pageId, 'page');

  // Connect page to type
  const typeId = `type_${safeId(section)}`;
  addEdge(typeId, pageId, 'member');

  // Connect page to category (if exists)
  if (metadata.category) {
    const catId = `cat_${safeId(metadata.category)}`;
    addEdge(catId, pageId, 'member');
  }

  // Connect page to date (if exists)
  if (metadata.dateYear && metadata.dateMonth) {
    const dateKey = `${metadata.dateYear}/${metadata.dateMonth}`;
    const dateId = `date_${safeId(dateKey)}`;
    addEdge(dateId, pageId, 'member');
  }

  // Image nodes
  for (const [idx, img] of e.images.slice(0, MAX_IMAGES).entries()) {
    const imgId = `${pageId}_img_${idx + 1}`;
    addNode({
      id: imgId,
      label: `img ${idx + 1}`,
      kind: 'image',
      url: img,
      img: img,
      section
    });
    addEdge(pageId, imgId, 'asset');

    // Connect to asset host if external
    try {
      const imgHost = new URL(img).host;
      if (imgHost !== siteHost) {
        const hostId = `assethost_${safeId(imgHost)}`;
        addEdge(hostId, pageId, 'related');
      }
    } catch {}
  }
}

// Write graph.json
const graph: Graph = { nodes, edges };
fs.writeFileSync(
  path.join(OUT_DIR, "graph.json"),
  JSON.stringify(graph, null, 2)
);

// =============================================================================
// UNIFIED.MMD GENERATION (Full site Mermaid diagram)
// =============================================================================

let unified = "";
unified += `%%{init: {"securityLevel":"loose"}}%%\n`;
unified += `flowchart TB\n`;
unified += `  site_root["${mmdEscape(siteHost)}"]:::site\n\n`;

// Add sections
for (const key of sortedGroupKeys) {
  const segId = safeId(`seg_${key}`);
  unified += `  subgraph cluster_${segId} ["${mmdEscape(key)} cluster"]\n`;
  unified += `    ${segId}_anchor[" "]:::anchor\n`;
  unified += `  end\n`;
  unified += `  site_root --> ${segId}_anchor\n\n`;
}

// Add pages to sections (limited to avoid massive diagram)
for (const key of sortedGroupKeys) {
  const list = (groups.get(key) ?? []).slice(0, 10); // Limit to 10 pages per section
  const segId = safeId(`seg_${key}`);

  for (const e of list) {
    const pageId = safeId(e.loc);
    unified += `  ${pageId}["${mmdEscape(titleFromUrl(e.loc))}"]:::page\n`;
    unified += `  ${segId}_anchor --> ${pageId}\n`;
    unified += `  click ${pageId} "${clickUrlEscape(e.loc)}"\n`;

    // Add first image only
    if (e.images.length > 0) {
      const imgId = `${pageId}_img_1`;
      unified += `  ${imgId}["img 1"]:::image\n`;
      unified += `  ${pageId} -.-> ${imgId}\n`;
      unified += `  click ${imgId} "${clickUrlEscape(e.images[0])}"\n`;
    }
  }
  unified += `\n`;
}

unified += `  classDef site font-size:14px,stroke-width:2px,stroke:#475569,fill:#f8fafc;\n`;
unified += `  classDef section font-weight:bold,stroke:#64748b,fill:#f1f5f9;\n`;
unified += `  classDef anchor opacity:0;\n`;
unified += `  classDef page stroke:#06b6d4,fill:#ecfeff;\n`;
unified += `  classDef image stroke:#fb923c,fill:#fff7ed,stroke-dasharray:3 3;\n`;

fs.writeFileSync(path.join(OUT_DIR, "unified.mmd"), unified);

console.log(`✅ Wrote: ${OUT_DIR}/index.mmd, ${OUT_DIR}/unified.mmd, ${SECTIONS_DIR}/*.mmd, ${OUT_DIR}/graph.json, ${OUT_DIR}/assets.json`);
console.log(`   Graph stats: ${nodes.length} nodes, ${edges.length} edges`);
console.log(`   Excluded patterns: ${EXCLUDE.join(", ")}`);
