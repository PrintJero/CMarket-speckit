-- AlterTable
ALTER TABLE "message_threads" ADD COLUMN     "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "message_threads_lastMessageAt_idx" ON "message_threads"("lastMessageAt");
