export const DISPLAY_NAME_MAX_LENGTH = 50;

export function normalizeDisplayName(displayName: string): string {
  return displayName.trim();
}

export function isValidDisplayName(displayName: string): boolean {
  const trimmed = normalizeDisplayName(displayName);
  return trimmed.length > 0 && trimmed.length <= DISPLAY_NAME_MAX_LENGTH;
}
