import Link from "next/link";
import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "secondary" | "dangerOutline";

const base =
  "inline-flex items-center justify-center gap-2 rounded-pill font-semibold transition-colors disabled:cursor-default disabled:opacity-60";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-brand px-5 py-3 text-[13px] font-bold uppercase tracking-wider text-white hover:bg-brand-dark",
  secondary:
    "border border-border bg-surface px-5 py-3 text-sm text-ink hover:bg-bg",
  dangerOutline:
    "border border-danger bg-transparent px-3.5 py-1.5 text-sm text-danger hover:bg-danger hover:text-white",
};

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
}

/** Native `<button>`, styled to match one of the app's button variants. */
export function Button({
  variant = "primary",
  fullWidth = false,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${base} ${variantClasses[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
}

export interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
}

/** A `<Link>` styled identically to `Button`, for navigational actions that look like buttons. */
export function LinkButton({
  variant = "primary",
  fullWidth = false,
  className = "",
  ...props
}: LinkButtonProps) {
  return (
    <Link
      className={`${base} ${variantClasses[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
}
