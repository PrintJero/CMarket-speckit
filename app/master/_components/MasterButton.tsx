import Link from "next/link";
import type { ComponentProps } from "react";

export type MasterButtonVariant = "primary" | "secondary" | "dangerOutline" | "ghost";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-colors disabled:cursor-default disabled:opacity-50";

// Restrained radius + compact padding + normal case, unlike the marketplace's
// pill-shaped, uppercase Button — MASTER intentionally reads as a distinct,
// denser administrative surface (see MasterButton vs. app/_components/Button).
const variantClassName: Record<MasterButtonVariant, string> = {
  primary: "bg-master px-3.5 py-2 text-white hover:bg-master-dark",
  secondary: "border border-border bg-surface px-3.5 py-2 text-ink hover:bg-bg",
  dangerOutline: "border border-danger/30 bg-surface px-3.5 py-2 text-danger hover:bg-danger-tint",
  ghost: "px-2.5 py-1.5 text-ink-muted hover:bg-bg hover:text-ink",
};

export interface MasterButtonProps extends ComponentProps<"button"> {
  variant?: MasterButtonVariant;
  fullWidth?: boolean;
}

/** Native `<button>` for the authenticated MASTER area's own visual system. */
export function MasterButton({
  variant = "primary",
  fullWidth = false,
  className = "",
  ...props
}: MasterButtonProps) {
  return (
    <button
      className={`${base} ${variantClassName[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
}

export interface MasterLinkButtonProps extends ComponentProps<typeof Link> {
  variant?: MasterButtonVariant;
  fullWidth?: boolean;
}

/** A `<Link>` styled identically to MasterButton, for navigational actions. */
export function MasterLinkButton({
  variant = "primary",
  fullWidth = false,
  className = "",
  ...props
}: MasterLinkButtonProps) {
  return (
    <Link
      className={`${base} ${variantClassName[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
}
