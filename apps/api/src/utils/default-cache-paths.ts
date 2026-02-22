import { tmpdir } from "node:os";
import { join } from "node:path";

const SHARED_CACHE_DIR = join(tmpdir(), "campfire-allowed-near-me");

export const DEFAULT_FORESTRY_RAW_CACHE_PATH = join(
  SHARED_CACHE_DIR,
  "forestry-raw-pages.json"
);
