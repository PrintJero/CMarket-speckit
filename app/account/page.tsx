import { notFound } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { DisplayNameForm } from "./DisplayNameForm";

export default async function AccountPage() {
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  return (
    <div className="operator-shell">
      <div className="operator-container">
        <div className="operator-header">
          <h1>Account</h1>
        </div>
        <section className="operator-panel-card">
          {!account.displayName && <p className="micro-label">Display name not set yet.</p>}
          <DisplayNameForm currentDisplayName={account.displayName} />
        </section>
      </div>
    </div>
  );
}
