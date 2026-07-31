-- CreateEnum
CREATE TYPE "TransactionState" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "stockQuantity" INTEGER;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "buyerId" TEXT,
ADD COLUMN     "quantity" INTEGER,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "sellerId" TEXT,
ADD COLUMN     "state" "TransactionState",
ADD COLUMN     "totalCents" INTEGER,
ALTER COLUMN "recorderId" DROP NOT NULL,
ALTER COLUMN "counterpartId" DROP NOT NULL,
ALTER COLUMN "confirmationState" DROP NOT NULL,
ALTER COLUMN "confirmationState" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "transactions_buyerId_idx" ON "transactions"("buyerId");

-- CreateIndex
CREATE INDEX "transactions_sellerId_idx" ON "transactions"("sellerId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
