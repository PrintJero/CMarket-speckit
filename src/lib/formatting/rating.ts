export function formatAverageRating(value: number | null): string {
  return value === null ? "No ratings yet" : value.toFixed(1);
}
