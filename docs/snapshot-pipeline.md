# Snapshot Generation Pipeline

## Overview

Snapshot generation is decomposed into independent stages with JSON checkpoints between them. Each stage can be run individually, enabling faster iteration on specific parts of the pipeline.

The pipeline separates **scraping** (expensive HTTP fetches, proxy/browser) from **parsing** (offline, from saved HTML/JSON). This means you can re-run parsing without re-scraping.

## Stages

### 1. Scrape (raw data acquisition)

Three independent scrape sub-stages that fetch raw pages and save them as archives:

| Sub-stage | Script | Output | Needs browser? | Needs proxy? |
|---|---|---|---|---|
| Forestry pages | `pipeline/scripts/scrape-forestry.ts` | `data/pipeline/raw-forestry-pages.json` | Yes (Cloudflare) | Yes (CI only) |
| Closure notices | `pipeline/scripts/scrape-closures.ts` | `data/pipeline/raw-closure-pages.json` | No | Yes (CI only) |
| Total Fire Ban | `pipeline/scripts/scrape-total-fire-ban.ts` | `data/pipeline/raw-total-fire-ban.json` | No | No |

Scrape stages save **raw HTML/JSON** (not parsed data). All HTTP requests happen here; no subsequent stage makes network calls to the scraped sources.

### 2. Parse (offline extraction)

Three parse sub-stages that read raw archives and produce structured JSON:

| Sub-stage | Script | Input | Output |
|---|---|---|---|
| Forestry | `pipeline/scripts/parse-forestry.ts` | `raw-forestry-pages.json` | `data/pipeline/scrape-forestry.json` |
| Closures | `pipeline/scripts/parse-closures.ts` | `raw-closure-pages.json` | `data/pipeline/scrape-closures.json` |
| Total Fire Ban | `pipeline/scripts/parse-total-fire-ban.ts` | `raw-total-fire-ban.json` | `data/pipeline/scrape-total-fire-ban.json` |

**Parse stages make zero HTTP requests.** They re-use the same parser functions as the scrapers but read HTML from saved archives. If you change parsing logic (e.g. fix a regex), re-run only the parse stage.

### 3. Geocode (coordinate resolution)

| Script | Input | Output |
|---|---|---|
| `pipeline/scripts/geocode-forests.ts` | `scrape-forestry.json` | `data/pipeline/geocoded-forests.json` |

Reads the forest names from the parse-forestry output, runs geocoding (Nominatim + Google fallback), and saves coordinates for each forest. Uses the existing SQLite coordinate cache.

### 4. Enrich closures (LLM augmentation)

| Script | Input | Output |
|---|---|---|
| `pipeline/scripts/enrich-closures.ts` | `scrape-closures.json` | `data/pipeline/enriched-closures.json` |

Reads parsed closure notices, runs `ClosureImpactEnricher` (OpenAI LLM analysis), and saves enriched notices with structured impact assessments.

### 5. Assemble snapshot (final processing)

| Script | Inputs | Output |
|---|---|---|
| `pipeline/scripts/assemble-snapshot.ts` | All intermediate files | `web/public/forests-snapshot.json` |

Reads all intermediate pipeline outputs and assembles the final snapshot:
- Matches facilities to forests (fuzzy name matching)
- Looks up Total Fire Ban status per forest (using geocoded coordinates + TFB geo-polygons)
- Matches closure notices to forests
- Merges multi-area forests
- Validates the snapshot
- Writes final snapshot + metadata

### Full pipeline (all stages)

`pipeline/scripts/generate-snapshot.ts` runs all stages in sequence. This is what CI uses.

## Raw pages archive format

Scrape stages produce archives in this format (same as `RawPageCache` on-disk format):

```typescript
interface RawPagesArchive {
  schemaVersion: number;      // currently 1
  pages: Record<string, {
    fetchedAt: string;         // ISO timestamp
    finalUrl: string;          // URL after redirects
    html: string;              // raw page body (HTML or JSON text)
  }>;
}
```

The `html` field stores the raw response body. For Total Fire Ban, this is JSON text (not HTML).

## Intermediate file format

Parse and downstream stages produce JSON with a common envelope:

```typescript
interface PipelineStageOutput<T> {
  stage: string;       // stage identifier
  version: number;     // schema version for this stage's output
  createdAt: string;   // ISO timestamp
  data: T;             // stage-specific payload
}
```

## File locations

```
data/pipeline/
  raw-forestry-pages.json     # raw HTML archive (scrape stage)
  raw-closure-pages.json      # raw HTML archive (scrape stage)
  raw-total-fire-ban.json     # raw JSON archive (scrape stage)
  scrape-forestry.json        # parsed areas + directory (parse stage)
  scrape-closures.json        # parsed closure notices (parse stage)
  scrape-total-fire-ban.json  # parsed TFB snapshot (parse stage)
  geocoded-forests.json
  enriched-closures.json
```

The final snapshot is written to `web/public/forests-snapshot.json` (same as before).

## Running individual stages

```bash
# --- Scrape (fetch raw data) ---
npx -y tsx pipeline/scripts/scrape-forestry.ts
npx -y tsx pipeline/scripts/scrape-closures.ts
npx -y tsx pipeline/scripts/scrape-total-fire-ban.ts

# --- Parse (from saved HTML/JSON, no HTTP) ---
npx -y tsx pipeline/scripts/parse-forestry.ts
npx -y tsx pipeline/scripts/parse-closures.ts
npx -y tsx pipeline/scripts/parse-total-fire-ban.ts

# --- Re-parse only (skip expensive scraping) ---
# After changing parsing logic, re-run only parse + downstream:
npx -y tsx pipeline/scripts/parse-closures.ts
npx -y tsx pipeline/scripts/enrich-closures.ts
npx -y tsx pipeline/scripts/assemble-snapshot.ts

# --- Downstream ---
npx -y tsx pipeline/scripts/geocode-forests.ts
npx -y tsx pipeline/scripts/enrich-closures.ts
npx -y tsx pipeline/scripts/assemble-snapshot.ts

# --- Full pipeline (all stages in sequence) ---
npx -y tsx pipeline/scripts/generate-snapshot.ts
```

## Design decisions

- **Raw HTML archives, not just parsed data**: Scrape stages save the full raw HTML/JSON from scraped pages. This allows re-running parsing without expensive re-scraping (proxy, browser, Cloudflare bypass).
- **Scrape → Parse separation**: Scraping (HTTP-dependent) and parsing (offline) are separate pipeline stages. If parsing logic changes, only the parse stage needs to re-run.
- **LLM enrichment is separate from parsing**: `ClosureImpactEnricher` runs after parsing, so parsing can be iterated on without burning LLM tokens.
- **Geocoding is separate from assembly**: The geocode stage only resolves coordinates. The assemble stage combines coordinates with everything else (facility matching, TFB lookup, closure matching).
- **Pipeline files are gitignored**: `data/pipeline/` is ephemeral working data, not committed.
- **Archive format reuses RawPageCache schema**: The raw page archive uses the same `{ schemaVersion, pages }` format as the `RawPageCache` on-disk file, so scrape stages can export directly from the cache.
