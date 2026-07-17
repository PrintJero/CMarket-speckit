/** This product serves Mexican communities; listing prices display as MXN (FR-022). */
export const LISTING_CURRENCY = "MXN";
export const LISTING_LOCALE = "es-MX";

export const listingPriceFormatter = new Intl.NumberFormat(LISTING_LOCALE, {
  style: "currency",
  currency: LISTING_CURRENCY,
});

export function formatListingPrice(priceCents: number): string {
  return listingPriceFormatter.format(priceCents / 100);
}
