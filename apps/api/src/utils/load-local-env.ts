import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILENAMES = [".env", ".env.local"] as const;

const stripWrappingQuotes = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const first = trimmed[0];
  const last = trimmed.at(-1);
  if ((first === '"' || first === "'") && first === last) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const parseEnvLine = (line: string): { key: string; value: string } | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  const rawValue = trimmed.slice(separatorIndex + 1);
  const value = stripWrappingQuotes(rawValue);

  return {
    key,
    value
  };
};

export const loadLocalEnv = (cwd = process.cwd()): void => {
  for (const filename of ENV_FILENAMES) {
    const path = resolve(cwd, filename);
    if (!existsSync(path)) {
      continue;
    }

    const isLocalOverride = filename === ".env.local";
    const raw = readFileSync(path, "utf8");
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
      const parsed = parseEnvLine(line);
      if (!parsed) {
        continue;
      }

      if (isLocalOverride || process.env[parsed.key] === undefined) {
        process.env[parsed.key] = parsed.value;
      }
    }
  }
};
