-- admins: web admin accounts. password_hash is bcrypt.
-- A default admin is seeded by AuthService on startup if the table is empty.
CREATE TABLE "admins" (
  "id"            TEXT PRIMARY KEY,
  "username"      TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "admins_username_key" ON "admins" ("username");
