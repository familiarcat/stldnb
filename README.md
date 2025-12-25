# STLDNB Sitemap Tools

Modern sitemap visualization and navigation system for WordPress sites.

## Features

### Dual Visualization Modes

1. **Mermaid Diagrams** - Static flowcharts with pan/zoom
   - Overview: High-level site structure by section
   - Full Site: Complete hierarchy with all pages and images
   - SVG exports for sharing

2. **Thought Map** - Interactive graph exploration (Cytoscape.js)
   - Click-to-drill-down navigation
   - Breadcrumb history with back button
   - 4 view dimensions: Section, Category, Date, Asset Host
   - 4 layout algorithms: Hierarchical, Radial, Timeline, Force-directed
   - Real-time search with highlighting
   - Configurable depth (1-10 levels)
   - Show/hide images and non-subtree nodes

### Rich Semantic Graph

The system generates a comprehensive graph from WordPress sitemaps containing:

- **Site root** - Top-level node
- **Sections** - URL path segments (blog, shop, events, etc.)
- **Categories** - WordPress post categories extracted from URLs
- **Dates** - Temporal grouping (YYYY/MM) for blog posts
- **Pages** - Individual pages/posts with metadata
- **Images** - Asset images linked to pages
- **Asset Hosts** - CDN/external image hosts

### State Persistence

Bookmark and share specific views via URL parameters:

```
?root=section_blog          # Focus on blog section
&dim=category               # Group by category
&layout=radial              # Use radial layout
&depth=5                    # Show 5 levels deep
&q=liquid                   # Search for "liquid"
&tab=thought                # Start on Thought Map
```

## Quick Start

```bash
# Install dependencies
npm install

# Build sitemap (fetches from WordPress, generates all outputs)
npm run sitemap:build

# Build and serve locally
npm run sitemap:serve
# Then visit http://localhost:8090
```

## Project Structure

```
scripts/
├── build-sitemap.js              # Main orchestrator
├── build-sitemap.sh              # Pipeline script
├── sitemap-to-mermaid.ts         # Graph + Mermaid generation
├── build-sitemap-viewer.ts       # HTML viewer generation
├── merge-sitemaps-recursive.sh   # WordPress sitemap merger
└── sitemap-combined.xml          # Merged XML input

dist/sitemap/
├── index.html                    # Interactive viewer
├── graph.json                    # Rich semantic graph
├── assets.json                   # Image URLs by page
├── index.mmd                     # Overview Mermaid diagram
├── unified.mmd                   # Full site Mermaid diagram
├── sitemap.svg                   # Overview SVG export
├── unified.svg                   # Full SVG export
├── sections/                     # Per-section Mermaid diagrams
└── vendor/                       # Vendored Cytoscape.js
```

## Data Flow

```
WordPress Sitemaps (sitemaps.xml)
    ↓
merge-sitemaps-recursive.sh → scripts/sitemap-combined.xml
    ↓
sitemap-to-mermaid.ts → graph.json + Mermaid diagrams
    ↓
build-sitemap-viewer.ts → index.html
    ↓
@mermaid-js/mermaid-cli → SVG exports
```

## Usage Guide

### Mermaid View

- **Pan**: Click and drag
- **Zoom**: Ctrl/Cmd + Mouse wheel
- **Reset**: Double-click viewport
- **Navigate**: Click section boxes to drill down
- **Export**: Use SVG download buttons

### Thought Map View

#### Navigation

- **Click nodes** to drill down (makes that node the new root)
- **Breadcrumbs** show your navigation path
- **Back button** returns to previous view
- **Root selector** lets you jump to any section/category/date

#### View Dimensions

- **Section** - Organize by URL path (blog, shop, events)
- **Category** - Group by WordPress categories (liquid, neurofunk, etc.)
- **Date** - Group by post date (YYYY/MM)
- **Asset Host** - Organize by CDN/image hosts

#### Layouts

- **Hierarchical** - Tree layout (left → right)
- **Radial** - Circular layout (root at center)
- **Timeline** - Chronological (for date views)
- **Force-directed** - Organic physics-based layout

#### Filtering

- **Search box** - Find nodes by label, URL, or category
- **Depth slider** - Control how many levels deep (only applies when drilling down)
- **Show images** - Toggle image node visibility
- **Focus mode** - When enabled, hides nodes outside current subtree (off by default)

#### Node Types & Colors

- **Site** (dark gray) - Root node
- **Section** (light gray) - URL path segments
- **Category** (indigo) - WordPress categories
- **Date** (amber) - Temporal groupings
- **Page** (cyan) - Individual pages/posts
- **Image** (orange, dashed) - Asset images

## Configuration

### Build Options

```bash
# Customize graph generation
node --import tsx ./scripts/sitemap-to-mermaid.ts \
  --max-images=5 \        # Max images per page (default: 3)
  --group-depth=2 \       # URL depth for grouping (default: 1)
  --section-depth=4       # Max depth inside sections (default: 3)
```

### URL Parameters Reference

| Param | Values | Description |
|-------|--------|-------------|
| `tab` | mermaid, thought | Which tab to show |
| `root` | node ID | Focus root node |
| `dim` | section, category, date, asset-host | View dimension |
| `layout` | breadthfirst, radial, timeline, force | Layout algorithm |
| `depth` | 1-10 | Max depth to show |
| `q` | search term | Search query |
| `imgs` | 0, 1 | Show images (default: 1) |
| `focus` | 0, 1 | Focus mode - hide unrelated nodes (default: 0) |

## Development

### Adding New Metadata

To extract additional metadata from sitemaps:

1. Update `extractMetadata()` in `sitemap-to-mermaid.ts`
2. Add new node kind to `NodeKind` type
3. Create nodes in graph generation
4. Add dimension case in `populateRootSelector()`
5. Update CSS colors in `build-sitemap-viewer.ts`

### Graph Schema

```typescript
interface NodeData {
  id: string;
  label: string;
  kind: 'site' | 'section' | 'category' | 'date' | 'page' | 'image' | 'type' | 'asset_host';
  url?: string;
  img?: string;
  section?: string;
  category?: string;
  date?: string;
  postType?: string;
}

interface EdgeData {
  id: string;
  source: string;
  target: string;
  kind: 'contains' | 'page' | 'member' | 'asset' | 'related';
}
```

## Troubleshooting

### Graph not loading?

```bash
# Rebuild from scratch
rm -rf dist/sitemap
npm run sitemap:build
```

### Categories missing?

- Check that `sitemap-combined.xml` has full data
- Run `npm run sitemap:merge` to fetch fresh data
- Verify WordPress sitemap includes all content types

### Layout performance issues?

- Reduce depth slider (try depth 2-3)
- Enable "Hide non-subtree" mode
- Use hierarchical layout instead of force-directed
- Disable image nodes if many assets

### Blank page?

- Check browser console for errors
- Verify `graph.json` and `.mmd` files exist
- Try `npm run sitemap:serve` instead of opening file directly
- Check that Cytoscape vendored properly

## npm Scripts

| Command | Description |
|---------|-------------|
| `sitemap:merge` | Fetch and merge WordPress sitemaps |
| `sitemap:build` | Full build pipeline |
| `sitemap:serve` | Build + serve on localhost:8090 |

## Requirements

- Node.js 18+
- npm or pnpm
- Modern browser with ES modules support

## License

Private - STLDNB
