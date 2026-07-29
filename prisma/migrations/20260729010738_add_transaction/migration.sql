-- CreateEnum
CREATE TYPE "TransactionPaymentPath" AS ENUM ('OFF_PLATFORM');

-- CreateEnum
CREATE TYPE "TransactionConfirmationState" AS ENUM ('UNCONFIRMED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "recorderId" TEXT NOT NULL,
    "counterpartId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "listingTitle" TEXT NOT NULL,
    "paymentPath" "TransactionPaymentPath" NOT NULL DEFAULT 'OFF_PLATFORM',
    "confirmationState" "TransactionConfirmationState" NOT NULL DEFAULT 'UNCONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "operationalEpoch" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transactions_communityId_idx" ON "transactions"("communityId");

-- CreateIndex
CREATE INDEX "transactions_recorderId_idx" ON "transactions"("recorderId");

-- CreateIndex
CREATE INDEX "transactions_counterpartId_idx" ON "transactions"("counterpartId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recorderId_fkey" FOREIGN KEY ("recorderId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_counterpartId_fkey" FOREIGN KEY ("counterpartId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
