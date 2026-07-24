"use client";

import { useRouter } from "next/navigation";
import { Button } from "../../_components/Button";

export function MasterActions({ masterId, status }: { masterId: string; status: "ACTIVE" | "DISABLED" }) {
  const router = useRouter();

  async function call(action: "disable" | "reactivate" | "reset-password") {
    const response = await fetch(`/api/master/masters/${masterId}/${action}`, { method: "POST" });
    const data = await response.json();
    if (data.ok && action === "reset-password") {
      window.alert(`New temporary password (shown once): ${data.temporaryPassword}`);
    } else if (!data.ok) {
      window.alert(`Failed: ${data.reason}`);
    }
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      {status === "ACTIVE" ? (
        <Button variant="dangerOutline" onClick={() => call("disable")}>
          Disable
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => call("reactivate")}>
          Reactivate
        </Button>
      )}
      <Button variant="secondary" onClick={() => call("reset-password")}>
        Reset password
      </Button>
    </div>
  );
}
