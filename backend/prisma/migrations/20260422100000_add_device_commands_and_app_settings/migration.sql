-- device_commands: per-device command log (request_location_now, ring_alarm,
-- toggle_tracking, lock_device). Status transitions:
--   pending -> delivered -> executed | failed
-- A 30s timeout in the server flips pending to failed.
CREATE TABLE "device_commands" (
  "id"           TEXT PRIMARY KEY,
  "device_id"    TEXT NOT NULL,
  "command"      TEXT NOT NULL,
  "payload"      JSONB,
  "status"       TEXT NOT NULL DEFAULT 'pending',
  "error"        TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delivered_at" TIMESTAMP(3),
  "executed_at"  TIMESTAMP(3),
  CONSTRAINT "device_commands_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "device_commands_device_id_status_idx"
  ON "device_commands" ("device_id", "status");

CREATE INDEX "device_commands_created_at_idx"
  ON "device_commands" ("created_at");

-- app_settings: key-value store for global config shared across all devices.
-- Used right now for the global tracking interval (intervalSec).
CREATE TABLE "app_settings" (
  "key"        TEXT PRIMARY KEY,
  "value"      JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed the default tracking interval (30s, matching mobile TRACKING_INTERVAL_MS).
INSERT INTO "app_settings" ("key", "value")
VALUES ('tracking_interval_sec', '30'::jsonb);
