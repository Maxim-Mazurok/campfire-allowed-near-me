import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const readJsonFile = async <T>(filePath: string): Promise<T | null> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const writeJsonFile = async <T>(
  filePath: string,
  value: T
): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
};
