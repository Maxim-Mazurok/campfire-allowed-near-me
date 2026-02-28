import { existsSync, rmSync } from "node:fs";

const cachePaths = [
  "data/cache/coordinates.sqlite",
  "data/cache/coordinates.sqlite-shm",
  "data/cache/coordinates.sqlite-wal",
  "data/cache/forests-snapshot.json",
  "data/cache/forestry-raw-pages.json",
  "data/cache/geocode-cache.json"
];

let removedFiles = 0;

for (const cachePath of cachePaths) {
  if (!existsSync(cachePath)) {
    continue;
  }

  rmSync(cachePath, { force: true });
  removedFiles += 1;
  // eslint-disable-next-line no-console
  console.log(`Removed ${cachePath}`);
}

// eslint-disable-next-line no-console
console.log(`Cache reset complete. Removed ${removedFiles} file(s).`);
