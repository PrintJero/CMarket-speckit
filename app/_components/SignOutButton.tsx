"use client";

export function SignOutButton() {
  async function onClick() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <button
      className="p-0 text-[13px] font-bold text-danger hover:underline"
      type="button"
      onClick={onClick}
    >
      Sign out
    </button>
  );
}
