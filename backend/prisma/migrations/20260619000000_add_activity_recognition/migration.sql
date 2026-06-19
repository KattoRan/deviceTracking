-- Activity Recognition: thêm cột activity vào location_history để track
-- hành vi (STILL/WALKING/RUNNING/ON_BICYCLE/IN_VEHICLE) tại thời điểm fix.
-- Nullable vì client cũ không gửi field này; Google ML model có thể không
-- confident → null.
ALTER TABLE "location_history"
  ADD COLUMN "activity" VARCHAR(20),
  ADD COLUMN "activity_confidence" SMALLINT;
