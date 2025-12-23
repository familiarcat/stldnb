#!/usr/bin/env bash
set -euo pipefail

ROOT="https://www.stldnb.com/sitemaps.xml"
OUT="sitemap-combined.xml"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

say() { printf "%s\n" "$*"; }

fetch() {
  # prints body
  curl -fsSL "$1"
}

is_index() {
  grep -q "<sitemapindex" <<<"$1"
}

is_urlset() {
  grep -q "<urlset" <<<"$1"
}

extract_sitemaps_from_index() {
  # prints sitemap <loc> values from an index doc
  grep -oE '<loc>[^<]+' | sed 's#<loc>##'
}

extract_urls_from_urlset() {
  # prints <url>...</url> blocks
  sed -n '/<url>/,/<\/url>/p'
}

visited="$tmpdir/visited.txt"
: > "$visited"

crawl() {
  local url="$1"

  # prevent loops
  if grep -Fxq "$url" "$visited"; then
    return 0
  fi
  echo "$url" >> "$visited"

  local xml
  xml="$(fetch "$url")"

  if is_index "$xml"; then
    say "INDEX  $url"
    # recurse into each referenced sitemap
    while IFS= read -r child; do
      [[ -n "$child" ]] && crawl "$child"
    done < <(printf "%s" "$xml" | extract_sitemaps_from_index)

  elif is_urlset "$xml"; then
    say "URLSET $url"
    printf "%s" "$xml" | extract_urls_from_urlset >> "$tmpdir/urls.xml"

  else
    say "SKIP   $url (unknown XML type)"
  fi
}

# Crawl starting from the root sitemap (index or urlset)
crawl "$ROOT"

# Build combined sitemap
{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  cat "$tmpdir/urls.xml" 2>/dev/null || true
  echo '</urlset>'
} > "$tmpdir/combined-raw.xml"

# Dedupe by <loc> (keeps first occurrence)
awk '
  BEGIN { RS="</url>"; ORS=""; }
  /<url>/ {
    loc=""
    if (match($0, /<loc>[^<]+<\/loc>/)) {
      loc=substr($0, RSTART+5, RLENGTH-11)
    }
    if (loc != "" && !seen[loc]++) {
      print $0 "</url>\n"
    }
  }
' "$tmpdir/combined-raw.xml" > "$OUT"

say "✅ Wrote $OUT"
