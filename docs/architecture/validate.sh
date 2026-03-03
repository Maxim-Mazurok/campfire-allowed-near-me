#!/usr/bin/env bash
# Validates the Structurizr DSL workspace using the official CLI Docker image.
# Runs both syntax validation and architecture inspections (errors + warnings).
# Usage: ./docs/architecture/validate.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Validating Structurizr workspace syntax…"
docker run --rm \
  -v "${SCRIPT_DIR}:/usr/local/structurizr" \
  structurizr/cli \
  validate -workspace /usr/local/structurizr/workspace.dsl

echo "Running architecture inspections…"
docker run --rm \
  -v "${SCRIPT_DIR}:/usr/local/structurizr" \
  structurizr/cli \
  inspect -workspace /usr/local/structurizr/workspace.dsl -severity error,warning

echo "✓ Workspace is valid with zero errors and zero warnings."
