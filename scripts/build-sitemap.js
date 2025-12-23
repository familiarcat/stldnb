#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const input = process.argv[2] ?? "sitemap-combined.xml";
if (!fs.existsSync(input)) {
  console.error("❌ Missing sitemap:", input);
  process.exit(1);
}
spawnSync("bash", ["./scripts/build-sitemap.sh", input], { stdio: "inherit" });
