import { Prisma, AuditActorType, AuditOutcome } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type AuditDbClient = typeof prisma | Prisma.TransactionClient;

/**
 * research.md #6: a plain string column, not a Prisma enum — this feature
 * alone names 20+ distinct action shapes and more will be added by future
 * specs. This closed TS union is the compile-time-checked authority for what
 * "action" may currently contain; extend it here as later phases add more.
 */
export type AdministrativeAction =
  | "master.create"
  | "master.disable"
  | "master.reactivate"
  | "master.resetPassword"
  | "community.create"
  | "community.edit"
  | "community.suspend"
  | "community.reactivate"
  | "community.archive"
  | "community.restore"
  | "membership.promote"
  | "membership.remove"
  | "account.edit"
  | "account.suspend"
  | "account.reactivate"
  | "account.resetPassword"
  | "account.delete";

export interface WriteAuditEntryInput {
  actorType: AuditActorType;
  actorMasterId?: string | null;
  action: AdministrativeAction;
  targetType: string;
  targetId?: string | null;
  outcome: AuditOutcome;
  /** Sanitized before/after values or failure reason. Never a secret (FR-070). */
  detail?: Record<string, unknown> | null;
}

/**
 * data-model.md's Writer discipline (research.md #6): pass the active `tx`
 * for a SUCCESS entry that must commit atomically with its mutation; pass
 * the plain `prisma` client for a FAILURE entry, written independently,
 * after the guarded attempt's own transaction has already rolled back.
 * Never nested inside the transaction whose rollback it records.
 *
 * No update/delete function exists in this module (FR-071) — immutability
 * is enforced by omission, not a DB trigger.
 */
export async function writeAuditEntry(
  client: AuditDbClient,
  input: WriteAuditEntryInput,
): Promise<void> {
  await client.administrativeAuditEntry.create({
    data: {
      actorType: input.actorType,
      actorMasterId: input.actorMasterId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      outcome: input.outcome,
      detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export interface ListAuditEntriesOptions {
  from?: Date;
  to?: Date;
  actorMasterId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  /** Opaque cursor — the `id` of the last entry from a previous page. */
  cursor?: string;
  pageSize?: number;
}

export interface AuditEntrySummary {
  id: string;
  actorType: AuditActorType;
  actorMasterId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: AuditOutcome;
  detail: unknown;
  createdAt: Date;
}

export interface ListAuditEntriesResult {
  entries: AuditEntrySummary[];
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * FR-073, SC-012: every filter is a database `WHERE` clause, and pagination
 * is cursor-based — never an in-memory filter/slice over a fully loaded
 * table.
 */
export async function listAuditEntries(
  options: ListAuditEntriesOptions = {},
): Promise<ListAuditEntriesResult> {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));

  const entries = await prisma.administrativeAuditEntry.findMany({
    where: {
      ...(options.from || options.to
        ? { createdAt: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lte: options.to } : {}) } }
        : {}),
      ...(options.actorMasterId ? { actorMasterId: options.actorMasterId } : {}),
      ...(options.action ? { action: options.action } : {}),
      ...(options.targetType ? { targetType: options.targetType } : {}),
      ...(options.targetId ? { targetId: options.targetId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = entries.length > pageSize;
  const page = entries.slice(0, pageSize);

  return {
    entries: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}
