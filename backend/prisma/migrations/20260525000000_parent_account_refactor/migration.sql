-- =====================================================================
-- Parent-account refactor.
--
-- Destructive: drops users + admins tables, removes Device.user_id and
-- Device.geofence_id. Replaces with ParentAccount + Device(parent_account_id,
-- person_name, person_type) + n:n device_geofences join + sos_events +
-- push_subscriptions.
--
-- In dev: run `prisma migrate reset` to wipe data before applying.
-- =====================================================================

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('CHILD', 'ELDERLY');

-- DropTable (admins replaced by parent_accounts)
DROP TABLE IF EXISTS "admins";

-- Drop devices FKs we are about to remove
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_user_id_fkey";
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_geofence_id_fkey";

-- Drop now-unused indexes
DROP INDEX IF EXISTS "devices_user_id_idx";
DROP INDEX IF EXISTS "devices_geofence_id_idx";

-- Drop columns from devices (data loss in dev — run migrate reset)
ALTER TABLE "devices" DROP COLUMN IF EXISTS "user_id";
ALTER TABLE "devices" DROP COLUMN IF EXISTS "geofence_id";

-- DropTable (users replaced by parent_accounts + Device.person_*)
DROP TABLE IF EXISTS "users";

-- CreateTable parent_accounts
CREATE TABLE "parent_accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "pairing_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "parent_accounts_email_key" ON "parent_accounts"("email");
CREATE UNIQUE INDEX "parent_accounts_pairing_code_key" ON "parent_accounts"("pairing_code");

-- Add new columns to devices
ALTER TABLE "devices"
    ADD COLUMN "parent_account_id" TEXT NOT NULL,
    ADD COLUMN "person_name" TEXT NOT NULL,
    ADD COLUMN "person_type" "PersonType" NOT NULL,
    ADD COLUMN "last_battery" INTEGER,
    ADD COLUMN "is_offline_alerted" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "is_low_battery_alerted" BOOLEAN NOT NULL DEFAULT false;

-- phone_number is now nullable (some pairings may not collect it)
ALTER TABLE "devices" ALTER COLUMN "phone_number" DROP NOT NULL;

CREATE INDEX "devices_parent_account_id_idx" ON "devices"("parent_account_id");
ALTER TABLE "devices"
    ADD CONSTRAINT "devices_parent_account_id_fkey"
    FOREIGN KEY ("parent_account_id") REFERENCES "parent_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Add parent_account_id to geofences (scope geofences to a parent)
ALTER TABLE "geofences" ADD COLUMN "parent_account_id" TEXT NOT NULL;
CREATE INDEX "geofences_parent_account_id_idx" ON "geofences"("parent_account_id");
ALTER TABLE "geofences"
    ADD CONSTRAINT "geofences_parent_account_id_fkey"
    FOREIGN KEY ("parent_account_id") REFERENCES "parent_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable device_geofences (n:n join)
CREATE TABLE "device_geofences" (
    "device_id" TEXT NOT NULL,
    "geofence_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_geofences_pkey" PRIMARY KEY ("device_id", "geofence_id")
);
CREATE INDEX "device_geofences_device_id_idx" ON "device_geofences"("device_id");
CREATE INDEX "device_geofences_geofence_id_idx" ON "device_geofences"("geofence_id");
ALTER TABLE "device_geofences"
    ADD CONSTRAINT "device_geofences_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_geofences"
    ADD CONSTRAINT "device_geofences_geofence_id_fkey"
    FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable sos_events
CREATE TABLE "sos_events" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "parent_account_id" TEXT NOT NULL,
    "lat" DECIMAL(10,8) NOT NULL,
    "lon" DECIMAL(11,8) NOT NULL,
    "accuracy_m" DOUBLE PRECISION,
    "battery_level" INTEGER,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),

    CONSTRAINT "sos_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sos_events_parent_account_id_triggered_at_idx" ON "sos_events"("parent_account_id", "triggered_at");
CREATE INDEX "sos_events_device_id_triggered_at_idx" ON "sos_events"("device_id", "triggered_at");
ALTER TABLE "sos_events"
    ADD CONSTRAINT "sos_events_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sos_events"
    ADD CONSTRAINT "sos_events_parent_account_id_fkey"
    FOREIGN KEY ("parent_account_id") REFERENCES "parent_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable push_subscriptions
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "parent_account_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_parent_account_id_idx" ON "push_subscriptions"("parent_account_id");
ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_parent_account_id_fkey"
    FOREIGN KEY ("parent_account_id") REFERENCES "parent_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
