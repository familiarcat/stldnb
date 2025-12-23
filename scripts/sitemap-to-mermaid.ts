#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

type Entry = { loc: string; images: string[] };
type Node = { data: { id: string; label: string; kind: string; url?: string; img?: string; section?: string } };
type Edge = { data: { id: string; source: string; target: string; kind: string } };

const inputFile = process.argv[2] ?? "./sitemap-combined.xml";
const OUT_DIR = "./dist/sitemap";

// Mermaid controls
const MAX_IMAGES_MERMAID = 1;
const MAX_PAGES_PER_SECTION_OVERVIEW = 80;
const WEB_DEPTH_OVERVIEW = 2;

// Cytoscape controls
const MAX_RELATED_EDGES_PER_PAGE = 6;

function ensureDir(p: string) { fs.mkdirSync(p, { recursive: true }); }
function mmdEscape(s: string) {
  return s.replace(/\r?\n|\r/g, " ").replace(/\s+/g, " ").replace(/"/g, "'").replace(/\[/g, "(").replace(/\]/g, ")").trim();
}
function clickUrlEscape(u: string) { return u.replace(/"/g, "%22").replace(/\r?\n|\r/g, ""); }
function titleFromUrl(u: string) {
  try {
    const url = new URL(u);
    const p = url.pathname.replace(/\/+$/, "");
    if (!p) return "Home";
    const parts = p.split("/").filter(Boolean);
    const last = parts.at(-1) ?? "Page";
    return decodeURIComponent(last).replace(/-/g, " ");
  } catch { return u; }
}
function parts(u: string): string[] { try { return new URL(u).pathname.split("/").filter(Boolean); } catch { return []; } }
function topKey(u: string): string { const p = parts(u); return p[0] ?? "(root)"; }
function hostOf(u: string): string | null { try { return new URL(u).host; } catch { return null; } }
function hash8(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).slice(0, 8);
}
function safeId(s: string): string {
  const base = "n_" + s.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return `${base}_${hash8(s)}`;
}

// Parse XML
const xml = fs.readFileSync(inputFile, "utf8");
const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
function extractLoc(block: string): string { return (block.match(/<loc>([\s\S]*?)<\/loc>/)?.[1] ?? "").trim(); }
function extractImages(block: string): string[] {
  const cdata = Array.from(block.matchAll(/<image:loc>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/image:loc>/g)).map(m => m[1].trim());
  const plain = Array.from(block.matchAll(/<image:loc>\s*([^<\s][\s\S]*?)\s*<\/image:loc>/g))
    .map(m => m[1].trim()).filter(u => u && !u.startsWith("<![CDATA["));
  const all = [...cdata, ...plain].filter(Boolean);
  const seen = new Set<string>(); const out: string[] = [];
  for (const u of all) if (!seen.has(u)) { seen.add(u); out.push(u); }
  return out;
}

let entries: Entry[] = urlBlocks.map(b => ({ loc: extractLoc(b), images: extractImages(b) })).filter(e => !!e.loc);
if (entries.length === 0) { console.error("No <url><loc> entries found."); process.exit(1); }

const siteHost = (() => { try { return new URL(entries[0].loc).host; } catch { return "site"; } })();
ensureDir(OUT_DIR);

// assets.json
const assetsMap: Record<string, string[]> = {};
for (const e of entries) assetsMap[e.loc] = e.images;
fs.writeFileSync(path.join(OUT_DIR, "assets.json"), JSON.stringify(assetsMap, null, 2), "utf8");

// Group by section
const bySection = new Map<string, Entry[]>();
for (const e of entries) { const k = topKey(e.loc); bySection.set(k, [...(bySection.get(k) ?? []), e]); }
const sectionKeys = Array.from(bySection.keys()).sort((a, b) => a.localeCompare(b));

// graph.json with semantic nodes/edges
const nodes: Node[] = [];
const edges: Edge[] = [];
const nodeSeen = new Set<string>();
const edgeSeen = new Set<string>();
function addNode(n: Node) { if (nodeSeen.has(n.data.id)) return; nodeSeen.add(n.data.id); nodes.push(n); }
function addEdge(source: string, target: string, kind: string) {
  const key = `${kind}|${source}|${target}`;
  if (edgeSeen.has(key)) return;
  edgeSeen.add(key);
  edges.push({ data: { id: `e_${kind}_${hash8(source)}_${hash8(target)}`, source, target, kind } });
}

const siteId = "site_root";
addNode({ data: { id: siteId, label: siteHost, kind: "site", url: `https://${siteHost}` } });

const typeNodeId = new Map<string, string>();
const categoryNodeId = new Map<string, string>();
const dateNodeId = new Map<string, string>();
const assetHostNodeId = new Map<string, string>();

function ensureGroupNode(map: Map<string, string>, key: string, label: string, kind: string): string {
  const existing = map.get(key);
  if (existing) return existing;
  const id = safeId(`${kind}_${key}`);
  map.set(key, id);
  addNode({ data: { id, label, kind } });
  return id;
}

for (const k of sectionKeys) {
  const sid = safeId(`section_${k}`);
  addNode({ data: { id: sid, label: k, kind: "section" } });
  addEdge(siteId, sid, "contains");

  const list = (bySection.get(k) ?? []).slice().sort((a, b) => a.loc.localeCompare(b.loc));
  const pathNode = new Map<string, string>();
  const ensurePath = (pkey: string, label: string) => {
    const ex = pathNode.get(pkey);
    if (ex) return ex;
    const pid = safeId(`path_${k}_${pkey}`);
    pathNode.set(pkey, pid);
    addNode({ data: { id: pid, label, kind: "path", section: k } });
    return pid;
  };

  for (const e of list) {
    const ps = parts(e.loc);
    const rel = (k === "(root)") ? ps : ps.slice(1);
    let parent = sid;

    for (let i = 0; i < rel.length; i++) {
      const chain = rel.slice(0, i + 1);
      const pkey = chain.join("/");
      const pid = ensurePath(pkey, chain.at(-1) ?? pkey);
      const parentKey = chain.slice(0, -1).join("/");
      const parentId = (i === 0) ? sid : (pathNode.get(parentKey) ?? sid);
      addEdge(parentId, pid, "contains");
      parent = pid;
    }

    const pageId = safeId(`page_${e.loc}`);
    addNode({ data: { id: pageId, label: titleFromUrl(e.loc), kind: "page", url: e.loc, section: k } });
    addEdge(parent, pageId, "page");

    // type membership
    const typeId = ensureGroupNode(typeNodeId, `type:${k}`, `type: ${k}`, "type");
    addEdge(typeId, pageId, "member");

    // category membership
    const catIdx = rel.findIndex(seg => seg === "category");
    const cat = (catIdx >= 0 && rel[catIdx + 1]) ? rel[catIdx + 1] : null;
    if (cat) {
      const cid = ensureGroupNode(categoryNodeId, `cat:${cat.toLowerCase()}`, `category: ${cat}`, "category");
      addEdge(cid, pageId, "member");
    }

    // date membership: /YYYY/MM/
    const year = rel[0] && /^\d{4}$/.test(rel[0]) ? rel[0] : null;
    const month = year && rel[1] && /^\d{2}$/.test(rel[1]) ? rel[1] : null;
    if (year && month) {
      const did = ensureGroupNode(dateNodeId, `date:${year}/${month}`, `date: ${year}/${month}`, "date");
      addEdge(did, pageId, "member");
    }

    // images + asset host membership
    const imgHosts = new Set<string>();
    e.images.forEach((img, idx) => {
      const imgId = safeId(`img_${e.loc}_${idx}_${img}`);
      addNode({ data: { id: imgId, label: `img ${idx + 1}`, kind: "image", url: img, img, section: k } });
      addEdge(pageId, imgId, "asset");
      const h = hostOf(img);
      if (h) imgHosts.add(h);
    });
    for (const h of imgHosts) {
      const hid = ensureGroupNode(assetHostNodeId, `assethost:${h}`, `asset host: ${h}`, "asset_host");
      addEdge(hid, pageId, "related");
    }
  }
}

// Add "web" related edges among pages that share group membership, but keep it bounded
const pages = nodes.filter(n => n.data.kind === "page").map(n => n.data.id);
const pageSet = new Set(pages);
const groupToPages = new Map<string, string[]>();
for (const e of edges) {
  if (e.data.kind !== "member") continue;
  const group = e.data.source;
  const member = e.data.target;
  if (!pageSet.has(member)) continue;
  groupToPages.set(group, [...(groupToPages.get(group) ?? []), member]);
}

const relatedCount = new Map<string, number>();
const canAddRel = (pid: string) => (relatedCount.get(pid) ?? 0) < MAX_RELATED_EDGES_PER_PAGE;
const incRel = (pid: string) => relatedCount.set(pid, (relatedCount.get(pid) ?? 0) + 1);

for (const [, members] of groupToPages.entries()) {
  if (members.length < 2) continue;
  const ms = members.slice().sort();
  for (let i = 0; i < ms.length - 1; i++) {
    const a = ms[i], b = ms[i + 1];
    if (!canAddRel(a) || !canAddRel(b)) continue;
    addEdge(a, b, "related");
    incRel(a); incRel(b);
  }
}

fs.writeFileSync(path.join(OUT_DIR, "graph.json"), JSON.stringify({ nodes, edges }, null, 2), "utf8");

// Mermaid web-style (clustered)
function buildWebMermaid(full: boolean): string {
  let mmd = "";
  mmd += `%%{init: {"securityLevel":"loose","flowchart":{"useMaxWidth":false}}}%%\n`;
  mmd += `flowchart TB\n`;
  mmd += `  ${siteId}["${mmdEscape(siteHost)}"]:::site\n`;

  const lanes = ["lane1","lane2","lane3","lane4"];
  for (const lid of lanes) {
    mmd += `  subgraph ${lid}[" "]\n    direction TB\n  end\n`;
  }

  sectionKeys.forEach((k, i) => {
    const sid = safeId(`section_${k}`);
    mmd += `  ${sid}["${mmdEscape(k)}"]:::section\n`;
    mmd += `  ${lanes[i % 4]} --> ${sid}\n`;
    mmd += `  ${siteId} --> ${sid}\n`;
  });

  for (const k of sectionKeys) {
    const sid = safeId(`section_${k}`);
    const list = (bySection.get(k) ?? []).slice().sort((a, b) => a.loc.localeCompare(b.loc));
    const cap = full ? list : list.slice(0, MAX_PAGES_PER_SECTION_OVERVIEW);
    const subId = safeId(`subgraph_${k}`);

    mmd += `\n  subgraph ${subId}["${mmdEscape(k)} cluster"]\n    direction TB\n`;

    const pmap = new Map<string,string>();
    const ensureP = (chain: string[]) => {
      const key = chain.join("/");
      const ex = pmap.get(key);
      if (ex) return ex;
      const nid = safeId(`m_path_${k}_${key}`);
      pmap.set(key, nid);
      mmd += `    ${nid}["${mmdEscape(chain.at(-1) ?? key)}"]:::path\n`;
      return nid;
    };

    for (const e of cap) {
      const ps = parts(e.loc);
      const rel = (k === "(root)") ? ps : ps.slice(1);
      let parent = sid;

      const depth = full ? rel.length : Math.min(WEB_DEPTH_OVERVIEW, rel.length);
      for (let i = 0; i < depth; i++) {
        const chain = rel.slice(0, i + 1);
        const pid = ensureP(chain);
        const parentId = (i === 0) ? sid : (pmap.get(rel.slice(0, i).join("/")) ?? sid);
        mmd += `    ${parentId} --> ${pid}\n`;
        parent = pid;
      }

      const pageId = safeId(`m_page_${e.loc}`);
      mmd += `    ${pageId}["${mmdEscape(titleFromUrl(e.loc))}"]:::page\n`;
      mmd += `    ${parent} --> ${pageId}\n`;
      mmd += `    click ${pageId} "${clickUrlEscape(e.loc)}"\n`;

      const img = e.images[0];
      if (img && MAX_IMAGES_MERMAID > 0) {
        const imgId = safeId(`m_img_${e.loc}_${img}`);
        mmd += `    ${imgId}["img"]:::asset\n`;
        mmd += `    ${pageId} -.-> ${imgId}\n`;
        mmd += `    click ${imgId} "${clickUrlEscape(img)}"\n`;
      }
    }

    if (!full && list.length > MAX_PAGES_PER_SECTION_OVERVIEW) {
      const moreId = safeId(`more_${k}`);
      mmd += `    ${moreId}["… +${list.length - MAX_PAGES_PER_SECTION_OVERVIEW} more"]:::more\n`;
      mmd += `    ${sid} --> ${moreId}\n`;
    }

    mmd += `  end\n  ${sid} --> ${subId}\n`;
  }

  mmd += `\n`;
  mmd += `  classDef site fill:#f8fafc,stroke:#475569,color:#0f172a,stroke-width:2px;\n`;
  mmd += `  classDef section fill:#f1f5f9,stroke:#64748b,color:#0f172a;\n`;
  mmd += `  classDef path fill:#eef2ff,stroke:#818cf8,color:#111827;\n`;
  mmd += `  classDef page fill:#ecfeff,stroke:#06b6d4,color:#0f172a;\n`;
  mmd += `  classDef asset fill:#fff7ed,stroke:#fb923c,color:#7c2d12,stroke-dasharray:3 3;\n`;
  mmd += `  classDef more fill:#ffffff,stroke:#cbd5e1,color:#334155,stroke-dasharray:2 2;\n`;
  return mmd;
}

fs.writeFileSync(path.join(OUT_DIR, "index.mmd"), buildWebMermaid(false), "utf8");
fs.writeFileSync(path.join(OUT_DIR, "unified.mmd"), buildWebMermaid(true), "utf8");

console.log(`✅ Wrote: ${OUT_DIR}/index.mmd, ${OUT_DIR}/unified.mmd, ${OUT_DIR}/graph.json, ${OUT_DIR}/assets.json`);
