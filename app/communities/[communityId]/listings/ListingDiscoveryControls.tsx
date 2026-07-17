"use client";

import { useState } from "react";
import { FormField, FormError, fieldInputClassName } from "../../../_components/FormField";
import { Button } from "../../../_components/Button";
import { Card } from "../../../_components/Card";

/**
 * Plain GET-form search/filter bar (no fetch, no router.push): submitting
 * navigates to the same feed URL with q/minPrice/maxPrice in the query
 * string, which is what the server component re-reads (shareable/reloadable,
 * research.md #4 — no client-side filtering). Omitting a `page` field means
 * every submission naturally lands back on page 1.
 */
export function ListingDiscoveryControls({
  communityId,
  initialQuery,
  initialMinPrice,
  initialMaxPrice,
}: {
  communityId: string;
  initialQuery: string;
  initialMinPrice: string;
  initialMaxPrice: string;
}) {
  const [minPrice, setMinPrice] = useState(initialMinPrice);
  const [maxPrice, setMaxPrice] = useState(initialMaxPrice);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const min = minPrice === "" ? undefined : Number(minPrice);
    const max = maxPrice === "" ? undefined : Number(maxPrice);
    if (min !== undefined && max !== undefined && min > max) {
      event.preventDefault();
      setError("Minimum price cannot be greater than maximum price.");
      return;
    }
    setError(null);
  }

  return (
    <Card className="mb-6 p-5">
      <form
        method="GET"
        action={`/communities/${communityId}/listings`}
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-4"
      >
        <div className="min-w-[200px] flex-1">
          <FormField label="Search">
            <input
              className={fieldInputClassName}
              type="text"
              name="q"
              defaultValue={initialQuery}
              placeholder="Search title or description"
            />
          </FormField>
        </div>
        <div className="w-36">
          <FormField label="Minimum price">
            <input
              className={fieldInputClassName}
              type="number"
              name="minPrice"
              value={minPrice}
              onChange={(event) => setMinPrice(event.target.value)}
              placeholder="Min price (cents)"
            />
          </FormField>
        </div>
        <div className="w-36">
          <FormField label="Maximum price">
            <input
              className={fieldInputClassName}
              type="number"
              name="maxPrice"
              value={maxPrice}
              onChange={(event) => setMaxPrice(event.target.value)}
              placeholder="Max price (cents)"
            />
          </FormField>
        </div>
        <Button type="submit" className="mb-4">
          Search
        </Button>
        {error && (
          <div className="w-full">
            <FormError role="alert">{error}</FormError>
          </div>
        )}
      </form>
    </Card>
  );
}
