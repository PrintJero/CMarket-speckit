/** This product serves Mexican communities; listing prices display as MXN (FR-022). */
export const LISTING_CURRENCY = "MXN";
export const LISTING_LOCALE = "es-MX";

export const listingPriceFormatter = new Intl.NumberFormat(LISTING_LOCALE, {
  style: "currency",
  currency: LISTING_CURRENCY,
});

/** 011-wanted-posts: a WANTED post's budget is optional (nullable priceCents). */
export const BUDGET_PLACEHOLDER = "Budget not specified";

export function formatListingPrice(priceCents: number | null): string {
  if (priceCents === null) return BUDGET_PLACEHOLDER;
  return listingPriceFormatter.format(priceCents / 100);
}
