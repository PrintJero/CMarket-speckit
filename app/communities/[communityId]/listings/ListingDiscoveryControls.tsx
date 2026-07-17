"use client";

import { useState } from "react";

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
    <form
      method="GET"
      action={`/communities/${communityId}/listings`}
      onSubmit={handleSubmit}
      className="operator-notice"
    >
      <label className="field">
        <span className="field__label">Search</span>
        <input
          className="field__input"
          type="text"
          name="q"
          defaultValue={initialQuery}
          placeholder="Search title or description"
        />
      </label>
      <label className="field">
        <span className="field__label">Minimum price</span>
        <input
          className="field__input"
          type="number"
          name="minPrice"
          value={minPrice}
          onChange={(event) => setMinPrice(event.target.value)}
          placeholder="Min price (cents)"
        />
      </label>
      <label className="field">
        <span className="field__label">Maximum price</span>
        <input
          className="field__input"
          type="number"
          name="maxPrice"
          value={maxPrice}
          onChange={(event) => setMaxPrice(event.target.value)}
          placeholder="Max price (cents)"
        />
      </label>
      <button className="btn-primary" type="submit">
        Search
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
