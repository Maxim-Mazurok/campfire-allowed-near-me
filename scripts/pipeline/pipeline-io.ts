import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PipelineStageOutput } from "../../packages/shared/src/pipeline-types.js";

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
