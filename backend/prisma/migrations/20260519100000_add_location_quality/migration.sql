-- Add tiered quality metadata to location_history. Both columns nullable so
-- existing rows (written before this migration) keep loading; consumers
-- (polyline render, geofence eval) treat NULL as "unknown — include for
-- backward compatibility" or "exclude", depending on policy.

ALTER TABLE "location_history"
  ADD COLUMN "accuracy_m" DOUBLE PRECISION,
  ADD COLUMN "quality"    VARCHAR(16);

-- Lookups by quality are always device-scoped and chronological, mirroring
-- the existing (device_id, recorded_at) index. A composite covering index
-- keeps the polyline query a single index scan.
CREATE INDEX "location_history_device_id_quality_recorded_at_idx"
  ON "location_history" ("device_id", "quality", "recorded_at");
