"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { GoogleIcon } from "../../_components/GoogleIcon";
import { FormField, FormError, fieldInputClassName } from "../../_components/FormField";
import { Button } from "../../_components/Button";

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
      <h1 className="mb-1 text-center text-[1.375rem] font-bold text-ink">Sign in</h1>
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        {status === "error" && <FormError role="alert">{errorMessage}</FormError>}
        <Button type="submit" fullWidth disabled={status === "submitting"}>
          Sign in
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
      <p className="mt-5 text-center text-sm text-ink-muted">
        New to CMarket?{" "}
        <a href="/sign-up" className="font-semibold text-brand hover:underline">
          Sign up
        </a>
      </p>
    </>
  );
}
