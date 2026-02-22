const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

export const normalizeForestLabel = (value: string): string => normalizeWhitespace(value);

export const isLikelyStateForestName = (value: string): boolean => {
  const name = normalizeForestLabel(value);
  if (!name) {
    return false;
  }

  if (name.length > 120) {
    return false;
  }

  if (
    /^find a state forest$/i.test(name) ||
    /^defined state forest area$/i.test(name) ||
    /^includes:/i.test(name) ||
    /\bplanning your visit\b/i.test(name) ||
    /\bright to information\b/i.test(name) ||
    /\bmaps and spatial data\b/i.test(name) ||
    /\bcontracts held\b/i.test(name)
  ) {
    return false;
  }

  return /^[a-z0-9][a-z0-9 '&./()-]*state forest(?:\s*\([^)]*\))?$/i.test(name);
};
