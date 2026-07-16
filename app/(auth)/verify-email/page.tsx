"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

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
      <h1>Verify your email</h1>
      {status === "checking" && <p>Checking your verification link…</p>}
      {status === "verified" && <p>Your email is verified. You can now accept invitations.</p>}
      {(status === "invalid" || status === "none") && (
        <>
          <p>This link is no longer valid. Request a new one:</p>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__input"
              type="email"
              placeholder="you@example.com"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
            />
          </label>
          <button
            className="btn-primary"
            type="button"
            onClick={requestResend}
            disabled={resendSent}
          >
            Resend verification email
          </button>
          {resendSent && <p>If this email needs verifying, we&apos;ve sent a new link.</p>}
        </>
      )}
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<p>Checking your verification link…</p>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
