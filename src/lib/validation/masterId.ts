const MASTER_ID_PATTERN = /^[a-z0-9._-]+$/;
const MAX_MASTER_ID_LENGTH = 50;

/**
 * research.md #3: a Master ID is case-insensitive for uniqueness and sign-in,
 * and cannot be changed after creation — so normalizing on write is safe and
 * permanent, mirroring normalizeEmail().
 */
export function normalizeMasterId(masterId: string): string {
  return masterId.trim().toLowerCase();
}

export function isValidMasterId(masterId: string): boolean {
  const normalized = normalizeMasterId(masterId);
  return (
    normalized.length > 0 &&
    normalized.length <= MAX_MASTER_ID_LENGTH &&
    MASTER_ID_PATTERN.test(normalized)
  );
}
