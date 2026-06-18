-- Partial unique index trên devices.phone_number — mỗi SĐT chỉ được pair với
-- 1 device. Dùng partial (WHERE phone_number IS NOT NULL) vì cột này nullable
-- (1 device có thể không có SĐT) — partial cho phép nhiều NULL nhưng giá trị
-- non-null phải duy nhất.
CREATE UNIQUE INDEX "devices_phone_number_unique"
  ON "devices" ("phone_number")
  WHERE "phone_number" IS NOT NULL;
