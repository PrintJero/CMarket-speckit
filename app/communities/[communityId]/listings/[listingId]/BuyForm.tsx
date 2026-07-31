"use client";

import { useState } from "react";
import { FormField, FormError, fieldInputClassName } from "../../../../_components/FormField";
import { Button } from "../../../../_components/Button";
import { NonIntermediaryDisclosure } from "../../../../_components/NonIntermediaryDisclosure";

type ProposePurchaseResponse =
  | { ok: true; transaction: { id: string } }
  | {
      ok: false;
      reason:
        | "invalid_input"
        | "not_a_member"
        | "self_purchase"
        | "not_found"
        | "listing_not_active"
        | "stock_not_specified"
        | "exceeds_stock"
        | "seller_not_a_member";
    };

export interface BuyFormProps {
  communityId: string;
  listingId: string;
  /** Used only to recalculate the pre-filled total as quantity changes (FR-003, FR-004). */
  priceCents: number;
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * 013-purchase-flow-stock, FR-003, FR-004: quantity defaults to 1 with the
 * total pre-filled at listing price x quantity; increasing quantity
 * recalculates the total, which the buyer may then independently edit
 * (self-reported, e.g. a price negotiated in chat) before submitting.
 * FR-005: no payment-method step exists anywhere in this form.
 */
export function BuyForm({ communityId, listingId, priceCents }: BuyFormProps) {
  const [quantity, setQuantity] = useState(1);
  const [total, setTotal] = useState(formatCents(priceCents));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  function onQuantityChange(value: string) {
    const parsed = Math.trunc(Number(value));
    setQuantity(parsed);
    if (Number.isFinite(parsed) && parsed > 0) {
      setTotal(formatCents(priceCents * parsed));
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const totalCents = Math.round(Number(total) * 100);
    const response = await fetch(`/api/communities/${communityId}/listings/${listingId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity, totalCents }),
    });
    const data: ProposePurchaseResponse = await response.json();
    setSubmitting(false);

    if (!data.ok) {
      setError(`Failed: ${data.reason}`);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return <p data-testid="proposal-sent">Proposal sent! The seller will accept or reject it.</p>;
  }

  return (
    <form onSubmit={onSubmit}>
      <NonIntermediaryDisclosure />
      <FormField label="Quantity">
        <input
          className={fieldInputClassName}
          type="number"
          step="1"
          min="1"
          value={quantity}
          onChange={(e) => onQuantityChange(e.target.value)}
        />
      </FormField>
      <FormField label="Total">
        <input
          className={fieldInputClassName}
          type="number"
          step="0.01"
          min="0.01"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
        />
      </FormField>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" fullWidth disabled={submitting}>
        Send purchase proposal
      </Button>
    </form>
  );
}
