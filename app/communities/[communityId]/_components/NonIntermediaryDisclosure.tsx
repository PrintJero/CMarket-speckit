/** Constitution Principle IV, FR-014: shown before both recording and confirming a transaction. */
export function NonIntermediaryDisclosure() {
  return (
    <p className="mb-3 text-[13px] text-ink-muted" role="note">
      CMarket is not a financial intermediary and takes no responsibility for this payment. Money changes hands
      directly between you and the other member, entirely outside the app.
    </p>
  );
}
