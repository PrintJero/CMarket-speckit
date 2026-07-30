import type { ReactNode } from "react";

export const masterFieldInputClassName =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-muted/70 focus:border-master focus:ring-2 focus:ring-master/25";

export const masterFieldTextareaClassName = `${masterFieldInputClassName} resize-y`;

export const masterFieldSelectClassName = masterFieldInputClassName;

/** Visible label + optional supporting text + inline error — the one form-field shape for the authenticated MASTER area. */
export function MasterFormField({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-3.5 block">
      <span className="mb-1.5 flex items-center gap-1 text-[12.5px] font-semibold text-ink">
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {hint && <span className="mb-1.5 block text-[12px] text-ink-muted">{hint}</span>}
      {children}
      {error && (
        <span role="alert" className="mt-1 block text-[12px] font-semibold text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

/** Non-field-scoped status message (form-level success/failure), matching MasterFormField's error styling. */
export function MasterFormMessage({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "success";
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`mb-3 text-[12.5px] font-semibold ${tone === "error" ? "text-danger" : "text-success-dark"}`}
    >
      {children}
    </p>
  );
}
