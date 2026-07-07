CREATE TABLE "SingleCodeDiscount" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requiredTag" TEXT NOT NULL,
    "blockedTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SingleCodeDiscount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SingleCodeDiscount_shop_discountId_key" ON "SingleCodeDiscount"("shop", "discountId");
CREATE INDEX "SingleCodeDiscount_shop_idx" ON "SingleCodeDiscount"("shop");
