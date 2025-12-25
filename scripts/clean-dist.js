#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const dir = path.join("dist","sitemap");
if (!fs.existsSync(dir)) process.exit(0);

for (const name of fs.readdirSync(dir)) {
  if (name === "vendor") continue;
  fs.rmSync(path.join(dir,name), { recursive:true, force:true });
}
console.log("✅ Cleaned dist/sitemap (kept vendor/)");
