"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FormField, fieldInputClassName } from "../../_components/FormField";
import { Button } from "../../_components/Button";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"checking" | "verified" | "invalid" | "none">(
    token ? "checking" : "none",
  );

  useEffect(() => {
    if (!token) return;
    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then((response) => setStatus(response.ok ? "verified" : "invalid"))
      .catch(() => setStatus("invalid"));
  }, [token]);

  const [resendEmail, setResendEmail] = useState("");
  const [resendSent, setResendSent] = useState(false);

  async function requestResend() {
    await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: resendEmail }),
    });
    setResendSent(true);
  }

  return (
    <>
      <h1 className="mb-1 text-center text-[1.375rem] font-bold text-ink">Verify your email</h1>
      {status === "checking" && <p className="text-center">Checking your verification link…</p>}
      {status === "verified" && (
        <p className="text-center">Your email is verified. You can now accept invitations.</p>
      )}
      {(status === "invalid" || status === "none") && (
        <>
          <p className="text-center">This link is no longer valid. Request a new one:</p>
          <FormField label="Email">
            <input
              className={fieldInputClassName}
              type="email"
              placeholder="you@example.com"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
            />
          </FormField>
          <Button type="button" fullWidth onClick={requestResend} disabled={resendSent}>
            Resend verification email
          </Button>
          {resendSent && (
            <p className="mt-3 text-center text-sm text-ink-muted">
              If this email needs verifying, we&apos;ve sent a new link.
            </p>
          )}
        </>
      )}
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<p className="text-center">Checking your verification link…</p>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
