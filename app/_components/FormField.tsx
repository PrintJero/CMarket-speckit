import type { ReactNode } from "react";

/** Shared className for every text-style input/select in the app — spread onto whatever control FormField wraps. */
export const fieldInputClassName =
  "w-full rounded-pill bg-bg px-4 py-3 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand";

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink">{label}</span>
      {children}
    </label>
  );
}

export function FormError({
  children,
  role = "status",
}: {
  children: ReactNode;
  /** Sign-in/sign-up's client-side validation errors use "alert"; async submit failures elsewhere use "status". */
  role?: "status" | "alert";
}) {
  return (
    <p className="-mt-1 mb-3 text-[13px] font-semibold text-danger" role={role}>
      {children}
    </p>
  );
}
