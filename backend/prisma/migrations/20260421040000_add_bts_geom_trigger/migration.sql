-- bts_stations stores coordinates in `lat`/`lon` (not `latitude`/`longitude`
-- like location_history), so it needs its own trigger function.
CREATE OR REPLACE FUNCTION set_bts_geom()
RETURNS trigger AS $$
BEGIN
  NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_bts_geom ON bts_stations;
CREATE TRIGGER trg_set_bts_geom
BEFORE INSERT OR UPDATE OF lat, lon ON bts_stations
FOR EACH ROW EXECUTE FUNCTION set_bts_geom();

-- Backfill any rows that were inserted before the trigger existed.
UPDATE bts_stations
SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)
WHERE geom IS NULL;
