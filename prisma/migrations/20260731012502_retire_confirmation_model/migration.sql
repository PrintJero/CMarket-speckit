/*
  Warnings:

  - You are about to drop the column `confirmationState` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `confirmedAt` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `counterpartId` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `recorderId` on the `transactions` table. All the data in the column will be lost.
  - Made the column `buyerId` on table `transactions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `quantity` on table `transactions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `sellerId` on table `transactions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `state` on table `transactions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `totalCents` on table `transactions` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_counterpartId_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_recorderId_fkey";

-- DropIndex
DROP INDEX "transactions_counterpartId_idx";

-- DropIndex
DROP INDEX "transactions_recorderId_idx";

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "confirmationState",
DROP COLUMN "confirmedAt",
DROP COLUMN "counterpartId",
DROP COLUMN "recorderId",
ALTER COLUMN "buyerId" SET NOT NULL,
ALTER COLUMN "quantity" SET NOT NULL,
ALTER COLUMN "sellerId" SET NOT NULL,
ALTER COLUMN "state" SET NOT NULL,
ALTER COLUMN "state" SET DEFAULT 'PENDING',
ALTER COLUMN "totalCents" SET NOT NULL;

-- DropEnum
DROP TYPE "TransactionConfirmationState";
