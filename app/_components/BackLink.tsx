import Link from "next/link";
import { ArrowLeftIcon } from "./icons";

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-muted hover:text-ink"
    >
      <ArrowLeftIcon />
      {children}
    </Link>
  );
}
