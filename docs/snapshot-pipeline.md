# Snapshot Generation Pipeline

## Overview

Snapshot generation is decomposed into independent stages with JSON checkpoints between them. Each stage can be run individually, enabling faster iteration on specific parts of the pipeline.

## Stages

### 1. Scrape (raw data acquisition)

Three independent scrape sub-stages that can be re-run independently:

| Sub-stage | Script | Output | Needs browser? | Needs proxy? |
|---|---|---|---|---|
| Forestry pages | `scripts/pipeline/scrape-forestry.ts` | `data/pipeline/scrape-forestry.json` | Yes (Cloudflare) | Yes (CI only) |
| Closure notices | `scripts/pipeline/scrape-closures.ts` | `data/pipeline/scrape-closures.json` | No | Yes (CI only) |
| Total Fire Ban | `scripts/pipeline/scrape-total-fire-ban.ts` | `data/pipeline/scrape-total-fire-ban.json` | No | No |

**Forestry pages** scrapes the Solid Fuel Fire Ban entry page, each area sub-page, and the forests directory page (facilities). It produces parsed area/forest lists and facility filters.

**Closure notices** scrapes the FCNSW closures index and each detail page. It produces raw closure notices (without LLM enrichment).

**Total Fire Ban** fetches the RFS fire danger ratings XML and GeoJSON feeds. It produces area statuses and geo-polygons.

### 2. Geocode (coordinate resolution)

| Script | Input | Output |
|---|---|---|
| `scripts/pipeline/geocode-forests.ts` | `scrape-forestry.json` | `data/pipeline/geocoded-forests.json` |

Reads the forest names from the scrape-forestry output, runs geocoding (Nominatim + Google fallback), and saves coordinates for each forest. Uses the existing SQLite coordinate cache.

### 3. Enrich closures (LLM augmentation)

| Script | Input | Output |
|---|---|---|
| `scripts/pipeline/enrich-closures.ts` | `scrape-closures.json` | `data/pipeline/enriched-closures.json` |

Reads raw closure notices, runs `ClosureImpactEnricher` (OpenAI LLM analysis), and saves enriched notices with structured impact assessments.

### 4. Assemble snapshot (final processing)

| Script | Inputs | Output |
|---|---|---|
| `scripts/pipeline/assemble-snapshot.ts` | All intermediate files | `apps/web/public/forests-snapshot.json` |

Reads all intermediate pipeline outputs and assembles the final snapshot:
- Matches facilities to forests (fuzzy name matching)
- Looks up Total Fire Ban status per forest (using geocoded coordinates + TFB geo-polygons)
- Matches closure notices to forests
- Merges multi-area forests
- Validates the snapshot
- Writes final snapshot + metadata

### Full pipeline (all stages)

`scripts/generate-snapshot.ts` runs all stages in sequence. This is what CI uses.

## Intermediate file format

All intermediate files are JSON with a common envelope:

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
  scrape-forestry.json
  scrape-closures.json
  scrape-total-fire-ban.json
  geocoded-forests.json
  enriched-closures.json
```

The final snapshot is written to `apps/web/public/forests-snapshot.json` (same as before).

## Running individual stages

```bash
# Scrape only forestry pages (fire bans + directory)
npx -y tsx scripts/pipeline/scrape-forestry.ts

# Scrape only closures
npx -y tsx scripts/pipeline/scrape-closures.ts

# Scrape only Total Fire Ban data
npx -y tsx scripts/pipeline/scrape-total-fire-ban.ts

# Geocode forests (requires scrape-forestry output)
npx -y tsx scripts/pipeline/geocode-forests.ts

# Enrich closures with LLM (requires scrape-closures output)
npx -y tsx scripts/pipeline/enrich-closures.ts

# Assemble final snapshot (requires all intermediate files)
npx -y tsx scripts/pipeline/assemble-snapshot.ts

# Run full pipeline (all stages in sequence)
npx -y tsx scripts/generate-snapshot.ts
```

## Design decisions

- **Parsed data, not raw HTML**: Scrape stages output parsed/structured data, not raw HTML. The raw HTML is already cached by `RawPageCache` (JSON file cache with TTL). Structured data is what downstream stages need and is easier to inspect.
- **LLM enrichment is separate from scraping**: `ClosureImpactEnricher` was moved out of `ForestryScraper` to keep scraping pure (fetch + parse only). This allows re-running LLM enrichment without re-scraping.
- **Geocoding is separate from assembly**: The geocode stage only resolves coordinates. The assemble stage combines coordinates with everything else (facility matching, TFB lookup, closure matching).
- **Pipeline files are gitignored**: `data/pipeline/` is ephemeral working data, not committed.
