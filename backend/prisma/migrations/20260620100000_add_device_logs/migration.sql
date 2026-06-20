-- Device error/event logs từ mobile — admin có thể xem khi debug:
-- exception trong task, network fail, permission denied, etc.
CREATE TABLE "device_logs" (
  "id"         TEXT NOT NULL,
  "device_id"  TEXT NOT NULL,
  "level"      VARCHAR(16) NOT NULL,
  "message"    TEXT NOT NULL,
  "context"    JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "device_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_logs_device_id_created_at_idx"
  ON "device_logs" ("device_id", "created_at" DESC);

ALTER TABLE "device_logs"
  ADD CONSTRAINT "device_logs_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
