"use client";

export function MasterSignOutButton() {
  async function onClick() {
    await fetch("/api/master/sign-out", { method: "POST" });
    window.location.href = "/master/sign-in";
  }

  return (
    <button
      className="rounded-pill border border-border bg-surface px-3.5 py-1.5 text-[13px] font-semibold text-ink hover:bg-bg"
      type="button"
      onClick={onClick}
    >
      Sign out
    </button>
  );
}
