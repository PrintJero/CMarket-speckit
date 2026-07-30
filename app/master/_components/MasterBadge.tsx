/** Small "MASTER" tag next to the CMarket wordmark in the sidebar/mobile nav. */
export function MasterBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border border-master-border bg-master-tint px-1.5 py-0.5 font-master-mono text-[8.5px] font-bold uppercase tracking-[0.15em] text-master ${className}`}
    >
      Master
    </span>
  );
}
