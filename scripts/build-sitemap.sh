#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

INPUT_XML="${1:-sitemap-combined.xml}"
[[ -f "$INPUT_XML" ]] || { echo "❌ Missing sitemap XML: $INPUT_XML"; exit 1; }

node --import tsx ./scripts/sitemap-to-mermaid.ts "$INPUT_XML"
node --import tsx ./scripts/build-sitemap-viewer.ts

npx -y @mermaid-js/mermaid-cli -i ./dist/sitemap/index.mmd -o ./dist/sitemap/sitemap.svg
npx -y @mermaid-js/mermaid-cli -i ./dist/sitemap/unified.mmd -o ./dist/sitemap/unified.svg
