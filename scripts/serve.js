#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const PORT = Number(process.env.PORT || 8090);
const ROOT = path.resolve("dist/sitemap");

if (!fs.existsSync(ROOT)) {
  console.error("❌ dist/sitemap does not exist. Run: npm run sitemap:build");
  process.exit(1);
}

const MIME = {
  ".html":"text/html; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml",
  ".mmd":"text/plain; charset=utf-8",
  ".txt":"text/plain; charset=utf-8",
  ".png":"image/png",
  ".jpg":"image/jpeg",
  ".jpeg":"image/jpeg",
  ".webp":"image/webp"
};

function safeJoin(root, reqPath){
  const p = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
  return path.join(root, p);
}

const server = http.createServer((req,res)=>{
  const parsed = url.parse(req.url || "/");
  let pathname = parsed.pathname || "/";
  if (pathname === "/") pathname = "/index.html";

  const fp = safeJoin(ROOT, pathname);
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end("Forbidden"); return; }

  fs.readFile(fp, (err, data)=>{
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, {"Content-Type": MIME[ext] || "application/octet-stream"});
    res.end(data);
  });
});

server.listen(PORT, ()=>{
  console.log(`✅ Serving ${ROOT} at http://localhost:${PORT}`);
});
