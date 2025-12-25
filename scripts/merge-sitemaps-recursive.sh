#!/usr/bin/env bash
set -euo pipefail

OUT="scripts/sitemap-combined.xml"
TMP="$(mktemp -d)"

INDEX_URL="https://www.stldnb.com/sitemaps.xml"

echo "Fetching sitemap index: $INDEX_URL"
curl -s "$INDEX_URL" -o "$TMP/index.xml"

echo '<?xml version="1.0" encoding="UTF-8"?>' > "$OUT"
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' >> "$OUT"

grep -o '<loc>[^<]*</loc>' "$TMP/index.xml" | sed 's/<loc>//;s/<\/loc>//' | while read -r S; do
  echo "Merging $S"
  curl -s "$S" \
    | sed 's/<?xml[^>]*>//g' \
    | sed 's/<urlset[^>]*>//g' \
    | sed 's/<\/urlset>//g' \
    >> "$OUT"
done

echo '</urlset>' >> "$OUT"

echo "✅ Wrote $OUT"
