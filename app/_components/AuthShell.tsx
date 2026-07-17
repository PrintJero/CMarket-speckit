import type { ReactNode } from "react";
import { Card } from "./Card";

/** Decorated, centered-card shell shared by the (auth) route group and the token-based invitation-accept page. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-8">
      <div
        aria-hidden="true"
        className="auth-blob pointer-events-none absolute -left-[180px] -top-[180px] h-[480px] w-[480px]
          rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--color-brand)_0%,transparent_70%)]
          opacity-35 blur-[60px]"
      />
      <div
        aria-hidden="true"
        className="auth-blob auth-blob--two pointer-events-none absolute -bottom-[160px] -right-[160px]
          h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--color-brand)_0%,transparent_70%)]
          opacity-35 blur-[60px]"
      />
      <div className="relative z-10 mb-6 text-2xl font-extrabold tracking-tight text-brand">CMarket</div>
      <Card className="relative z-10 w-full max-w-[380px]">{children}</Card>
    </div>
  );
}
