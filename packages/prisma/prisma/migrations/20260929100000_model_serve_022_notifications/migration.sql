-- CreateEnum
CREATE TYPE "NotificationChannelKind" AS ENUM ('TEAMS_WORKFLOW', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AlertAxis" AS ENUM ('DEPLOY', 'MONITORING');

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "NotificationChannelKind" NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedTarget" TEXT,
    "recipientUserIds" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minSeverity" "NotificationSeverity" NOT NULL DEFAULT 'WARNING',
    "events" TEXT[],
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 0,
    "mutedModelIds" TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelAlertState" (
    "modelId" TEXT NOT NULL,
    "axis" "AlertAxis" NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "frozenColumns" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelAlertState_pkey" PRIMARY KEY ("modelId","axis")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "modelId" TEXT,
    "axis" "AlertAxis",
    "event" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationChannel_workspaceId_idx" ON "NotificationChannel"("workspaceId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_channelId_createdAt_idx" ON "NotificationDelivery"("channelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_channelId_eventKey_key" ON "NotificationDelivery"("channelId", "eventKey");

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelAlertState" ADD CONSTRAINT "ModelAlertState_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

