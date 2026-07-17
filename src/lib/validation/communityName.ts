/** FR-014: a blank/whitespace-only community name is rejected before any record is written. */
export function isValidCommunityName(name: string): boolean {
  return name.trim().length > 0;
}
