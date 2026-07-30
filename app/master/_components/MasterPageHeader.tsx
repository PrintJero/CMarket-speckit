import Link from "next/link";
import type { ReactNode } from "react";

export interface MasterBreadcrumbItem {
  label: string;
  href?: string;
}

/**
 * The one page-header shape used across every authenticated MASTER screen:
 * optional breadcrumb, title (+ optional status badge), optional supporting
 * description, and right-aligned actions. No decorative hero — operational,
 * not promotional.
 */
export function MasterPageHeader({
  title,
  subtitle,
  status,
  breadcrumb,
  primaryAction,
  secondaryActions,
}: {
  title: string;
  subtitle?: string;
  status?: ReactNode;
  breadcrumb?: MasterBreadcrumbItem[];
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
          {breadcrumb.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden="true">/</span>}
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-master hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-[1.375rem] font-bold tracking-tight text-ink">{title}</h1>
            {status}
          </div>
          {subtitle && <p className="mt-1 text-[13px] text-ink-muted">{subtitle}</p>}
        </div>
        {(primaryAction || secondaryActions) && (
          <div className="flex flex-none flex-wrap items-center gap-2">
            {secondaryActions}
            {primaryAction}
          </div>
        )}
      </div>
    </div>
  );
}
