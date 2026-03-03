#!/usr/bin/env bash
# Exports Structurizr workspace diagrams to a text-based format.
# Usage: ./docs/architecture/export.sh [format]
#   format: mermaid (default) | plantuml | dot | json
#
# Output is written to docs/architecture/export/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORMAT="${1:-mermaid}"
OUTPUT_DIR="${SCRIPT_DIR}/export"

mkdir -p "${OUTPUT_DIR}"

echo "Exporting workspace to ${FORMAT}…"
docker run --rm \
  -v "${SCRIPT_DIR}:/usr/local/structurizr" \
  structurizr/cli \
  export \
    -workspace /usr/local/structurizr/workspace.dsl \
    -format "${FORMAT}" \
    -output /usr/local/structurizr/export

echo "✓ Exported to ${OUTPUT_DIR}/"
ls -1 "${OUTPUT_DIR}/"
