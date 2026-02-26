import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PipelineStageOutput, RawPagesArchive } from "../../packages/shared/src/pipeline-types.js";
import { RAW_PAGES_ARCHIVE_VERSION } from "../../packages/shared/src/pipeline-types.js";

export const readPipelineFile = <T>(filePath: string, stage: string, version: number): T => {
  if (!existsSync(filePath)) {
    throw new Error(
      `Pipeline file not found: ${filePath}\nRun the "${stage}" stage first.`
    );
  }

  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as PipelineStageOutput<T>;

  if (raw.stage !== stage) {
    throw new Error(
      `Pipeline file ${filePath} has stage "${raw.stage}" but expected "${stage}".`
    );
  }

  if (raw.version !== version) {
    throw new Error(
      `Pipeline file ${filePath} has version ${raw.version} but expected ${version}. Re-run the "${stage}" stage.`
    );
  }

  console.log(`  Loaded ${filePath} (created ${raw.createdAt})`);
  return raw.data;
};

export const writePipelineFile = <T>(
  filePath: string,
  output: PipelineStageOutput<T>
): void => {
  const directory = dirname(filePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  writeFileSync(filePath, JSON.stringify(output, null, 2));
  console.log(`  Saved ${filePath}`);
};

// ---------------------------------------------------------------------------
// Raw pages archive helpers
// ---------------------------------------------------------------------------

export const writeRawPagesArchive = (
  filePath: string,
  archive: RawPagesArchive
): void => {
  const directory = dirname(filePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  writeFileSync(filePath, JSON.stringify(archive, null, 2));
  console.log(`  Saved raw pages archive ${filePath} (${Object.keys(archive.pages).length} pages)`);
};

export const readRawPagesArchive = (filePath: string): RawPagesArchive => {
  if (!existsSync(filePath)) {
    throw new Error(
      `Raw pages archive not found: ${filePath}\nRun the corresponding scrape stage first.`
    );
  }

  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<RawPagesArchive>;

  if (raw.schemaVersion !== RAW_PAGES_ARCHIVE_VERSION) {
    throw new Error(
      `Raw pages archive ${filePath} has schema version ${raw.schemaVersion} but expected ${RAW_PAGES_ARCHIVE_VERSION}. Re-run the scrape stage.`
    );
  }

  if (!raw.pages || typeof raw.pages !== "object") {
    throw new Error(
      `Raw pages archive ${filePath} has invalid pages field. Re-run the scrape stage.`
    );
  }

  const pageCount = Object.keys(raw.pages).length;
  console.log(`  Loaded raw pages archive ${filePath} (${pageCount} pages)`);
  return raw as RawPagesArchive;
};
