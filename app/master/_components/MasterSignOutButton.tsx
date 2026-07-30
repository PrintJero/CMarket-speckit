"use client";

export function MasterSignOutButton() {
  async function onClick() {
    await fetch("/api/master/sign-out", { method: "POST" });
    window.location.href = "/master/sign-in";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-none rounded-md border border-border bg-surface px-2 py-1 text-[11.5px] font-semibold text-ink-muted transition-colors hover:border-danger hover:text-danger"
    >
      Sign out
    </button>
  );
}
