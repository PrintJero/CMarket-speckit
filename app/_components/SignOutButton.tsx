"use client";

export function SignOutButton() {
  async function onClick() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <button className="btn-signout" type="button" onClick={onClick}>
      Sign out
    </button>
  );
}
