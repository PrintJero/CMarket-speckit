"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { masterFieldInputClassName } from "../_components/MasterFormField";
import { MasterButton } from "../_components/MasterButton";
import { SearchIcon } from "../../_components/icons";

export function SearchBox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");

  function apply() {
    router.push(search ? `/master/accounts?search=${encodeURIComponent(search)}` : "/master/accounts");
  }

  return (
    <div className="mb-4 flex gap-2">
      <div className="relative max-w-sm flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          className={`${masterFieldInputClassName} pl-9`}
          placeholder="Search by email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
        />
      </div>
      <MasterButton type="button" variant="secondary" onClick={apply}>
        Search
      </MasterButton>
    </div>
  );
}
