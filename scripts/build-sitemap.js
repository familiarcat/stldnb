#!/usr/bin/env node
import { spawnSync } from "node:child_process";
spawnSync("bash", ["./scripts/build-sitemap.sh", process.argv[2] ?? "sitemap-combined.xml"], { stdio: "inherit" });
