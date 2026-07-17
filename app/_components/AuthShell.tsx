import type { ReactNode } from "react";
import { Card } from "./Card";

/** Decorated, centered-card shell shared by the (auth) route group and the token-based invitation-accept page. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-8
        bg-[radial-gradient(ellipse_at_top,var(--color-brand-tint)_0%,var(--color-bg)_65%)]"
    >
      <div
        aria-hidden="true"
        className="auth-blob pointer-events-none absolute -left-50 -top-55 h-155 w-155
          rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--color-brand)_0%,transparent_70%)]
          opacity-60 blur-[70px]"
      />
      <div
        aria-hidden="true"
        className="auth-blob auth-blob--two pointer-events-none absolute -bottom-50 -right-50
          h-140 w-140 rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--color-brand-dark)_0%,transparent_70%)]
          opacity-55 blur-[70px]"
      />
      <div
        aria-hidden="true"
        className="auth-blob pointer-events-none absolute right-[8%] top-[8%] h-65 w-65
          rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--color-brand)_0%,transparent_70%)]
          opacity-40 blur-[50px]"
      />
      <div className="relative z-10 mb-8 text-5xl font-extrabold tracking-tight text-brand sm:text-4xl">
        CMarket
      </div>
      <Card className="relative z-10 w-full max-w-[380px]">{children}</Card>
    </div>
  );
}
