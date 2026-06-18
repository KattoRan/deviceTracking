-- Rename parent_accounts → manager_accounts (terminology refactor: hệ thống dùng
-- "người quản lý / quản lý" thay vì "phụ huynh"). Đồng thời rename
-- devices.person_name → owner_name. Migration idempotent — mỗi step được wrap
-- trong DO block chỉ rename nếu object cũ còn tồn tại; an toàn re-run sau khi
-- migration thất bại giữa chừng.

-- ── Rename main table + constraints/indexes ─────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'parent_accounts') THEN
    ALTER TABLE "parent_accounts" RENAME TO "manager_accounts";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'parent_accounts_pkey') THEN
    ALTER INDEX "parent_accounts_pkey" RENAME TO "manager_accounts_pkey";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'parent_accounts_email_key') THEN
    ALTER INDEX "parent_accounts_email_key" RENAME TO "manager_accounts_email_key";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'parent_accounts_pairing_code_key') THEN
    ALTER INDEX "parent_accounts_pairing_code_key" RENAME TO "manager_accounts_pairing_code_key";
  END IF;
END $$;

-- ── devices: parent_account_id → manager_account_id, person_name → owner_name
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='devices' AND column_name='parent_account_id') THEN
    ALTER TABLE "devices" RENAME COLUMN "parent_account_id" TO "manager_account_id";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='devices' AND column_name='person_name') THEN
    ALTER TABLE "devices" RENAME COLUMN "person_name" TO "owner_name";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='devices_parent_account_id_fkey') THEN
    ALTER TABLE "devices" RENAME CONSTRAINT "devices_parent_account_id_fkey" TO "devices_manager_account_id_fkey";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='devices_parent_account_id_idx') THEN
    ALTER INDEX "devices_parent_account_id_idx" RENAME TO "devices_manager_account_id_idx";
  END IF;
END $$;

-- ── geofences: parent_account_id → manager_account_id
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='geofences' AND column_name='parent_account_id') THEN
    ALTER TABLE "geofences" RENAME COLUMN "parent_account_id" TO "manager_account_id";
  END IF;
END $$;

-- geofences_parent_account_id_fkey không tồn tại trên DB này (Prisma không tạo
-- — có thể do schema cũ); chỉ rename nếu có để migration idempotent.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='geofences_parent_account_id_fkey') THEN
    ALTER TABLE "geofences" RENAME CONSTRAINT "geofences_parent_account_id_fkey" TO "geofences_manager_account_id_fkey";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='geofences_parent_account_id_idx') THEN
    ALTER INDEX "geofences_parent_account_id_idx" RENAME TO "geofences_manager_account_id_idx";
  END IF;
END $$;

-- ── sos_events: parent_account_id → manager_account_id
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sos_events' AND column_name='parent_account_id') THEN
    ALTER TABLE "sos_events" RENAME COLUMN "parent_account_id" TO "manager_account_id";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sos_events_parent_account_id_fkey') THEN
    ALTER TABLE "sos_events" RENAME CONSTRAINT "sos_events_parent_account_id_fkey" TO "sos_events_manager_account_id_fkey";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='sos_events_parent_account_id_triggered_at_idx') THEN
    ALTER INDEX "sos_events_parent_account_id_triggered_at_idx" RENAME TO "sos_events_manager_account_id_triggered_at_idx";
  END IF;
END $$;

-- ── Drop bts_raw — staging table không bị code đọc/ghi, chỉ là vestige từ
--    import OpenCellID cũ. Schema đã có @@ignore từ trước; giờ dọn luôn DB.
DROP TABLE IF EXISTS "bts_raw";
