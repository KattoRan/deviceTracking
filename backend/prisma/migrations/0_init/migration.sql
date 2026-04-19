-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "address" TEXT,
    "email" TEXT NOT NULL,
    "citizen_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "model" TEXT,
    "type" TEXT,
    "device_os" TEXT,
    "last_seen" TIMESTAMP(3),
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_history" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "latitude" DECIMAL(10,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "geom" geometry(Point,4326),
    "district" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cell_tower_history" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "mcc" INTEGER,
    "mnc" INTEGER,
    "lac" INTEGER,
    "cid" INTEGER,
    "pci" INTEGER,
    "type" TEXT,
    "is_serving" BOOLEAN NOT NULL DEFAULT false,
    "rssi" INTEGER,
    "signal_dbm" INTEGER,
    "recorded_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cell_tower_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bts_stations" (
    "id" SERIAL NOT NULL,
    "mcc" INTEGER NOT NULL,
    "mnc" INTEGER NOT NULL,
    "lac" INTEGER NOT NULL,
    "cid" INTEGER NOT NULL,
    "lat" DECIMAL(10,8) NOT NULL,
    "lon" DECIMAL(11,8) NOT NULL,
    "geom" geometry(Point,4326),
    "radio" TEXT,
    "range" INTEGER,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bts_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bts_raw" (
    "radio" TEXT,
    "mcc" INTEGER,
    "mnc" INTEGER,
    "lac" INTEGER,
    "cid" BIGINT,
    "psc" INTEGER,
    "lon" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "range" INTEGER,
    "rssi" INTEGER,
    "status" INTEGER,
    "ts1" BIGINT,
    "ts2" BIGINT,
    "reserved" INTEGER
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_citizen_id_key" ON "users"("citizen_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_phone_number_key" ON "devices"("phone_number");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE INDEX "location_history_device_id_recorded_at_idx" ON "location_history"("device_id", "recorded_at");

-- CreateIndex
CREATE INDEX "cell_tower_history_device_id_recorded_at_idx" ON "cell_tower_history"("device_id", "recorded_at");

-- CreateIndex
CREATE INDEX "bts_stations_mcc_mnc_lac_cid_idx" ON "bts_stations"("mcc", "mnc", "lac", "cid");

-- CreateIndex
CREATE UNIQUE INDEX "bts_stations_mcc_mnc_lac_cid_key" ON "bts_stations"("mcc", "mnc", "lac", "cid");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_history" ADD CONSTRAINT "location_history_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cell_tower_history" ADD CONSTRAINT "cell_tower_history_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Auto-populate geom from latitude/longitude on insert
CREATE OR REPLACE FUNCTION set_geom()
RETURNS trigger AS $$
BEGIN
  NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_geom
BEFORE INSERT ON location_history
FOR EACH ROW EXECUTE FUNCTION set_geom();
