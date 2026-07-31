"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Positions the conversation at its newest message on open, and again whenever a new
 * message arrives (research.md #4) — keyed on count, not the message array reference,
 * so unrelated re-renders that don't add a message don't re-trigger the scroll.
 */
export function ChatScrollArea({ messageCount, children }: { messageCount: number; children: ReactNode }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messageCount]);

  return (
    <div data-testid="message-area" className="flex-1 overflow-y-auto px-6 py-4">
      {children}
      <div ref={bottomRef} />
    </div>
  );
}
