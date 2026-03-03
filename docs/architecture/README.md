# C4 Architecture Diagrams

This directory contains the [C4 model](https://c4model.com) architecture diagrams for **Campfire Allowed Near Me**, written in [Structurizr DSL](https://docs.structurizr.com/dsl).

## Files

| File | Description |
|---|---|
| [workspace.dsl](workspace.dsl) | Structurizr DSL workspace defining all three C4 levels |

## Diagrams included

| View Key | C4 Level | Scope |
|---|---|---|
| `L1_SystemContext` | Level 1 — System Context | The system in its environment: users, bots, and external dependencies |
| `L2_Containers` | Level 2 — Container | Internal deployable units: web frontend, routes proxy, pages function, data pipeline, data stores, shared library |
| `L3_WebFrontend` | Level 3 — Component | Components inside the Web Frontend SPA |
| `L3_DataPipeline` | Level 3 — Component | Components inside the Data Pipeline (scrape → parse → geocode → enrich → assemble) |
| `L3_RoutesProxy` | Level 3 — Component | Components inside the Routes Proxy Worker |

## Prerequisites

The helper scripts use Docker. Make sure Docker is running.

```bash
docker pull structurizr/cli:latest
docker pull structurizr/lite:latest
```

## Validate

Check that the DSL is syntactically and structurally correct:

```bash
./docs/architecture/validate.sh
```

## Export to Mermaid / PlantUML / DOT

Generate diagram files in various formats:

```bash
# Mermaid (default)
./docs/architecture/export.sh

# PlantUML
./docs/architecture/export.sh plantuml

# DOT (Graphviz)
./docs/architecture/export.sh dot
```

Exported files are written to `docs/architecture/export/`.

## Render interactively (Structurizr Lite)

Launch a local web UI to browse and interact with the diagrams:

```bash
./docs/architecture/render.sh
```

Then open [http://localhost:8080](http://localhost:8080) in your browser. Press `Ctrl+C` to stop.

## CI integration

Add to your CI pipeline:

```yaml
- name: Validate C4 architecture diagrams
  run: ./docs/architecture/validate.sh
```
