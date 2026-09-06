CREATE TABLE "MasterCredential" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MasterCredential_email_key" ON "MasterCredential"("email");
