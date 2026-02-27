export const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

export const normalizeForestLabel = (value: string): string => normalizeWhitespace(value);

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
