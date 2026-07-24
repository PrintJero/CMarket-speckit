"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { fieldInputClassName } from "../../_components/FormField";
import { Button } from "../../_components/Button";

export function SearchBox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");

  function apply() {
    router.push(search ? `/master/accounts?search=${encodeURIComponent(search)}` : "/master/accounts");
  }

  return (
    <div className="mb-4 flex gap-2">
      <input
        className={`${fieldInputClassName} max-w-sm`}
        placeholder="Search by email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && apply()}
      />
      <Button variant="secondary" onClick={apply}>
        Search
      </Button>
    </div>
  );
}
