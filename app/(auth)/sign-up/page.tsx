"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { GoogleIcon } from "../../_components/GoogleIcon";

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
        <h1>Check your email</h1>
        <p>If this email can be used, we&apos;ve sent verification instructions.</p>
        <button className="btn-primary" type="button" onClick={onResend} disabled={resendSent}>
          Resend verification email
        </button>
        {resendSent && <p>If this email needs verifying, we&apos;ve sent a new link.</p>}
        <p className="form-footer-link">
          <a href="/sign-in">Back to sign in</a>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Sign up</h1>
      <form onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="field__input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="field__input"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Confirm password</span>
          <input
            className="field__input"
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
        {confirmError && (
          <p className="form-error" role="alert">
            {confirmError}
          </p>
        )}
        <button className="btn-primary" type="submit" disabled={status === "submitting"}>
          Create account
        </button>
      </form>
      <button
        className="btn-secondary btn-google"
        type="button"
        onClick={() => signIn("google", { callbackUrl: "/" })}
      >
        <GoogleIcon />
        <span>Continue with Google</span>
      </button>
      {status === "error" && (
        <p className="form-error" role="alert">
          {errorMessage}
        </p>
      )}
      <p className="form-footer-link">
        Already have an account? <a href="/sign-in">Sign in</a>
      </p>
    </>
  );
}
