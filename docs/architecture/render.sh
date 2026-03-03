#!/usr/bin/env bash
# Launches Structurizr Lite to interactively view and explore the C4 diagrams.
# Usage: ./docs/architecture/render.sh
# Then open http://localhost:8080 in your browser.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting Structurizr Lite on http://localhost:8080 …"
echo "Press Ctrl+C to stop."

docker run -it --rm \
  -p 8080:8080 \
  -v "${SCRIPT_DIR}:/usr/local/structurizr" \
  structurizr/lite
