"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { GoogleIcon } from "../../_components/GoogleIcon";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage("");

    const response = await fetch("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (response.ok) {
      window.location.href = "/";
      return;
    }

    // FR-010: generic message regardless of failure cause.
    setErrorMessage("Invalid email or password.");
    setStatus("error");
  }

  return (
    <>
      <h1>Sign in</h1>
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {status === "error" && (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        )}
        <button className="btn-primary" type="submit" disabled={status === "submitting"}>
          Sign in
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
      <p className="form-footer-link">
        New to CMarket? <a href="/sign-up">Sign up</a>
      </p>
    </>
  );
}
