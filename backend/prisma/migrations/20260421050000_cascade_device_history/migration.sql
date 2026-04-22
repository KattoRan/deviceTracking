-- Switch history tables to CASCADE so deleting a device wipes its history
-- (rather than the default RESTRICT, which would block `DELETE /devices/:id`).

ALTER TABLE "location_history"
  DROP CONSTRAINT "location_history_device_id_fkey",
  ADD CONSTRAINT "location_history_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cell_tower_history"
  DROP CONSTRAINT "cell_tower_history_device_id_fkey",
  ADD CONSTRAINT "cell_tower_history_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
