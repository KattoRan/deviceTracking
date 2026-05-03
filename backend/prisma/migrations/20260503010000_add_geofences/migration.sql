-- geofences: admin-defined safe zones (circle: center + radius in meters).
-- A device can belong to at most one geofence (devices.geofence_id).
-- Deleting a geofence detaches every device referencing it (ON DELETE SET NULL).
CREATE TABLE "geofences" (
  "id"         TEXT PRIMARY KEY,
  "name"       TEXT NOT NULL,
  "lat"        DECIMAL(10, 8) NOT NULL,
  "lon"        DECIMAL(11, 8) NOT NULL,
  "radius_m"   INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "geofences_radius_positive" CHECK ("radius_m" > 0)
);

ALTER TABLE "devices"
  ADD COLUMN "geofence_id" TEXT;

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_geofence_id_fkey"
  FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "devices_geofence_id_idx" ON "devices" ("geofence_id");
