"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { GoogleIcon } from "../../_components/GoogleIcon";
import { FormField, FormError, fieldInputClassName } from "../../_components/FormField";
import { Button } from "../../_components/Button";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [resendSent, setResendSent] = useState(false);

  // FR-024/FR-009/FR-021: identical, generic acknowledgement no matter the
  // email's real state (already sent, already verified, or rate-limited) —
  // reuses the existing, unchanged resend-verification endpoint (FR-014).
  async function onResend() {
    await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setResendSent(true);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    // FR-023: client-side typo guard only — no server request is made on a
    // mismatch, and the request body below is unchanged either way.
    if (password !== confirmPassword) {
      setConfirmError("Passwords do not match.");
      return;
    }
    setConfirmError("");

    setStatus("submitting");
    setErrorMessage("");

    const response = await fetch("/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (response.status === 202) {
      setStatus("done");
      return;
    }

    const data = await response.json().catch(() => ({}));
    setErrorMessage(data.error ?? "Something went wrong.");
    setStatus("error");
  }

  if (status === "done") {
    return (
      <>
        <h1 className="mb-1 text-center text-[1.375rem] font-bold text-ink">Check your email</h1>
        <p className="text-center">If this email can be used, we&apos;ve sent verification instructions.</p>
        <Button type="button" fullWidth onClick={onResend} disabled={resendSent}>
          Resend verification email
        </Button>
        {resendSent && (
          <p className="mt-3 text-center text-sm text-ink-muted">
            If this email needs verifying, we&apos;ve sent a new link.
          </p>
        )}
        <p className="mt-5 text-center text-sm text-ink-muted">
          <a href="/sign-in" className="font-semibold text-brand hover:underline">
            Back to sign in
          </a>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-center text-[1.375rem] font-bold text-ink">Sign up</h1>
      <form onSubmit={onSubmit}>
        <FormField label="Email">
          <input
            className={fieldInputClassName}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        <FormField label="Password">
          <input
            className={fieldInputClassName}
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <FormField label="Confirm password">
          <input
            className={fieldInputClassName}
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </FormField>
        {confirmError && <FormError role="alert">{confirmError}</FormError>}
        <Button type="submit" fullWidth disabled={status === "submitting"}>
          Create account
        </Button>
      </form>
      <Button
        variant="secondary"
        fullWidth
        type="button"
        className="mt-3"
        onClick={() => signIn("google", { callbackUrl: "/" })}
      >
        <GoogleIcon />
        <span>Continue with Google</span>
      </Button>
      {status === "error" && <FormError role="alert">{errorMessage}</FormError>}
      <p className="mt-5 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <a href="/sign-in" className="font-semibold text-brand hover:underline">
          Sign in
        </a>
      </p>
    </>
  );
}
