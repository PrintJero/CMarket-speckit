/** Shown wherever a fellow member would otherwise see no name at all (FR-011). Never the email address. */
export const DISPLAY_NAME_PLACEHOLDER = "A member";

export function resolveDisplayName(displayName: string | null): string {
  return displayName ?? DISPLAY_NAME_PLACEHOLDER;
}
