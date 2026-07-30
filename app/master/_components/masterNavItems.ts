import { GridIcon, BuildingIcon, UsersIcon, ShieldIcon, ListIcon } from "../../_components/icons";
import type { ComponentType } from "react";

export interface MasterNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Only "/master" itself needs exact matching — every other section owns its whole subtree. */
  exact?: boolean;
}

/** Single source of truth for MASTER navigation — shared by MasterSidebarNav and MasterMobileNav so they can never drift apart. Only implemented sections: no billing/analytics/access-code entries. */
export const MASTER_NAV_ITEMS: MasterNavItem[] = [
  { href: "/master", label: "Overview", icon: GridIcon, exact: true },
  { href: "/master/communities", label: "Communities", icon: BuildingIcon },
  { href: "/master/accounts", label: "Accounts", icon: UsersIcon },
  { href: "/master/masters", label: "Masters", icon: ShieldIcon },
  { href: "/master/audit-log", label: "Audit log", icon: ListIcon },
];

export function isMasterNavItemActive(pathname: string, item: MasterNavItem): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
