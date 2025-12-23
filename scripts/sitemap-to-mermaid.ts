#!/usr/bin/env node
import fs from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("Usage: sitemap-to-mermaid.ts <sitemap.xml>");
  process.exit(1);
}

const xml = fs.readFileSync(input, "utf8");
const urls = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g)).map(m => m[1]);

const cols = [[], [], [], []];
urls.forEach((u, i) => cols[i % 4].push(u));

let mmd = "flowchart TB\n";
mmd += 'site_root["www.stldnb.com"]:::root\n\n';

cols.forEach((group, i) => {
  mmd += `subgraph col${i}[" "]\n  direction TB\n`;
  group.forEach((u, idx) => {
    const id = `p${i}_${idx}`;
    mmd += `  ${id}["${u.replace(/"/g, "'")}"]:::page\n`;
    mmd += `  click ${id} "${u}"\n`;
    mmd += `  site_root --> ${id}\n`;
  });
  mmd += "end\n\n";
});

mmd += "classDef root fill:#f8fafc,stroke:#475569;\n";
mmd += "classDef page fill:#ecfeff,stroke:#06b6d4;\n";

fs.mkdirSync("dist/sitemap", { recursive: true });
fs.writeFileSync("sitemap.mmd", mmd);
fs.writeFileSync("dist/sitemap/index.mmd", mmd);
fs.writeFileSync("dist/sitemap/unified.mmd", mmd);
fs.writeFileSync("dist/sitemap/assets.json", "{}");
