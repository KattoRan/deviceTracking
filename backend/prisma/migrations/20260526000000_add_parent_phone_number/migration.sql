-- Optional parent contact phone, displayed to the monitored device so the
-- child/elderly knows who to call back. Existing rows stay NULL.
ALTER TABLE "parent_accounts" ADD COLUMN "phone_number" TEXT;
