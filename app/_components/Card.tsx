import type { ComponentProps } from "react";

export function Card({ className = "", ...props }: ComponentProps<"section">) {
  return (
    <section
      className={`rounded-card bg-surface p-7 shadow-card ${className}`}
      {...props}
    />
  );
}
