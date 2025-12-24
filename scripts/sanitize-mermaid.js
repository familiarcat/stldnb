#!/usr/bin/env node
/**
 * scripts/sanitize-mermaid.js
 * Standalone sanitizer to remove placeholder grouping nodes from Mermaid source:
 *  - "type: ..."
 *  - "date: ..."
 *  - "asset host: ..."
 *
 * Usage:
 *   node ./scripts/sanitize-mermaid.js in.mmd > out.mmd
 */
import fs from "node:fs";

const PLACEHOLDER_LABEL_RE = /^(type:\s|date:\s|asset host:\s)/i;

export function sanitizeMermaid(src) {
  const lines = src.split(/\r?\n/);

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
    if ([...placeholderIds].some(id => ln.match(new RegExp("^\\s*" + id + "\\s*\\[")))) continue;
    if ([...placeholderIds].some(id =>
      ln.includes(" " + id + " ") ||
      ln.includes("-->" + id) ||
      ln.includes(id + "-->") ||
      ln.trim().startsWith("click " + id + " ")
    )) continue;
    keep.push(ln);
  }
  return keep.join("\n");
}

if (process.argv[2]) {
  const src = fs.readFileSync(process.argv[2], "utf8");
  process.stdout.write(sanitizeMermaid(src));
}
