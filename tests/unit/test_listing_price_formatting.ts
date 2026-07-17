import { describe, expect, it } from "vitest";
import { formatListingPrice, listingPriceFormatter } from "@/lib/formatting/currency";

describe("listing price formatting (FR-022)", () => {
  it("is configured for Mexican pesos in the es-MX locale, not USD", () => {
    const resolved = listingPriceFormatter.resolvedOptions();
    expect(resolved.currency).toBe("MXN");
    expect(resolved.locale.toLowerCase()).toBe("es-mx");
  });

  it("formats priceCents using that MXN/es-MX formatter", () => {
    expect(formatListingPrice(25000)).toBe(
      new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(250),
    );
  });
});
