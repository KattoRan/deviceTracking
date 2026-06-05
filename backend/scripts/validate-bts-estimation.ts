/**
 * Step 1 — Validate crowdsourced BTS position estimation on REAL data.
 *
 * Idea: every time a device with a good GPS fix observes a cell, that fix is
 * an "anchor" for the cell's location. Over many anchors we estimate the tower
 * position WITHOUT any third-party API call. This script measures how accurate
 * the method WOULD be, by running it on towers whose TRUE position we already
 * know (resolved via UnwiredLabs, stored in bts_stations) and comparing.
 *
 * What the runs taught us (v1 → v2 → v3):
 *  - v1: raw anchor count is misleading — a stationary device dumps thousands of
 *    near-identical fixes that dominate and pin the estimate to where it SITS.
 *    → dedup anchors onto a spatial grid (one representative per ~GRID_M cluster).
 *  - v2: gating on geographic SPREAD backfired — high-spread cells had the WORST
 *    error. A centroid doesn't triangulate; it just averages, so a device roaming
 *    a wide area yields a fuzzy area-centre, not the tower. Low-spread-near-tower
 *    cells were the most accurate.
 *  - v3 (this): the useful axis is SIGNAL, not spread. Strong signal ⇒ device was
 *    close to the tower ⇒ its position is a good estimate. So: estimator =
 *    strongest-anchor / mean of top-K strongest; gate/confidence = max dBm.
 *
 * Read-only. Run:
 *   cd backend && npx ts-node --transpile-only scripts/validate-bts-estimation.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

// --- tunables ---------------------------------------------------------------
const MIN_OBS = 3; // ignore cells with fewer raw GPS anchors than this
const MAX_CELLS = 500; // cap cells analysed
const GRID_M = 50; // spatial dedup resolution
const TOPK = [1, 3, 5]; // top-K strongest estimators to compare (K=1 == strongest)
const DBM_GATE_SWEEP = [-75, -80, -85, -90, -95]; // gate cells by max observed dBm
// signal buckets for the "error vs max signal" table
const DBM_BUCKETS = [
  { label: 'strong  (> -80)', lo: -80, hi: 0 },
  { label: 'medium  (-95..-80)', lo: -95, hi: -80 },
  { label: 'weak    (< -95)', lo: -999, hi: -95 },
];

// --- geo helpers ------------------------------------------------------------
const R = 6_371_000;
const M_PER_DEG_LAT = 111_320;
const rad = (d: number) => (d * Math.PI) / 180;
function haversine(aLat: number, aLon: number, bLat: number, bLon: number) {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}
const median = (xs: number[]) => percentile([...xs].sort((a, b) => a - b), 50);

// --- estimators -------------------------------------------------------------
type Anchor = { lat: number; lon: number; dbm: number };

function plainCentroid(anchors: Anchor[]) {
  const lat = anchors.reduce((s, a) => s + a.lat, 0) / anchors.length;
  const lon = anchors.reduce((s, a) => s + a.lon, 0) / anchors.length;
  return { lat, lon };
}
function spreadMeters(anchors: Anchor[]) {
  const c = plainCentroid(anchors);
  const sq =
    anchors.reduce((s, a) => s + haversine(a.lat, a.lon, c.lat, c.lon) ** 2, 0) /
    anchors.length;
  return Math.sqrt(sq);
}
// mean position of the K strongest-signal anchors (K=1 == strongest single).
function topKStrongest(anchors: Anchor[], k: number) {
  const top = [...anchors].sort((a, b) => b.dbm - a.dbm).slice(0, k);
  return plainCentroid(top);
}

/**
 * Collapse anchors onto a ~GRID_M grid, keeping the strongest-signal sample as
 * each bucket's representative. Turns "thousands of fixes from one spot" into
 * one location so a stationary device no longer dominates.
 */
function dedupToGrid(anchors: Anchor[]): Anchor[] {
  const dLat = GRID_M / M_PER_DEG_LAT;
  const best = new Map<string, Anchor>();
  for (const a of anchors) {
    const dLon = GRID_M / (M_PER_DEG_LAT * Math.cos(rad(a.lat)) || 1);
    const key = `${Math.round(a.lat / dLat)}_${Math.round(a.lon / dLon)}`;
    const cur = best.get(key);
    if (!cur || a.dbm > cur.dbm) best.set(key, a);
  }
  return [...best.values()];
}

// --- main -------------------------------------------------------------------
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  type Row = {
    mcc: number;
    mnc: number;
    lac: number;
    cid: number;
    true_lat: string;
    true_lon: string;
    obs_lat: string;
    obs_lon: string;
    signal_dbm: number;
  };
  const rows = await prisma.$queryRaw<Row[]>`
    WITH eligible AS (
      SELECT b.mcc, b.mnc, b.lac, b.cid
      FROM bts_stations b
      JOIN cell_tower_history c
        ON c.mcc = b.mcc AND c.mnc = b.mnc AND c.lac = b.lac AND c.cid = b.cid
      JOIN location_history l
        ON l.device_id = c.device_id AND l.recorded_at = c.recorded_at
      WHERE l.quality = 'gps' AND c.signal_dbm IS NOT NULL
      GROUP BY b.mcc, b.mnc, b.lac, b.cid
      HAVING COUNT(*) >= ${MIN_OBS}
      ORDER BY COUNT(*) DESC
      LIMIT ${MAX_CELLS}
    )
    SELECT b.mcc, b.mnc, b.lac, b.cid,
           b.lat AS true_lat, b.lon AS true_lon,
           l.latitude  AS obs_lat,
           l.longitude AS obs_lon,
           c.signal_dbm AS signal_dbm
    FROM eligible e
    JOIN bts_stations b
      ON b.mcc = e.mcc AND b.mnc = e.mnc AND b.lac = e.lac AND b.cid = e.cid
    JOIN cell_tower_history c
      ON c.mcc = e.mcc AND c.mnc = e.mnc AND c.lac = e.lac AND c.cid = e.cid
    JOIN location_history l
      ON l.device_id = c.device_id AND l.recorded_at = c.recorded_at
    WHERE l.quality = 'gps' AND c.signal_dbm IS NOT NULL;
  `;

  if (rows.length === 0) {
    console.log('\nNo GPS-anchored history for any resolved cell yet.\n');
    await prisma.$disconnect();
    return;
  }

  type Cell = { key: string; tlat: number; tlon: number; raw: Anchor[] };
  const byCell = new Map<string, Cell>();
  for (const r of rows) {
    const key = `${r.mcc}-${r.mnc}-${r.lac}-${r.cid}`;
    let cell = byCell.get(key);
    if (!cell) {
      cell = { key, tlat: Number(r.true_lat), tlon: Number(r.true_lon), raw: [] };
      byCell.set(key, cell);
    }
    cell.raw.push({ lat: Number(r.obs_lat), lon: Number(r.obs_lon), dbm: r.signal_dbm });
  }

  type Result = {
    key: string;
    rawN: number;
    distinct: number;
    spread: number;
    maxDbm: number;
    errByK: Record<number, number>;
  };
  const results: Result[] = [];
  for (const cell of byCell.values()) {
    const deduped = dedupToGrid(cell.raw);
    const maxDbm = Math.max(...deduped.map((a) => a.dbm));
    const errByK: Record<number, number> = {};
    for (const k of TOPK) {
      const est = topKStrongest(deduped, k);
      errByK[k] = haversine(est.lat, est.lon, cell.tlat, cell.tlon);
    }
    results.push({
      key: cell.key,
      rawN: cell.raw.length,
      distinct: deduped.length,
      spread: spreadMeters(deduped),
      maxDbm,
      errByK,
    });
  }

  // --- report ---------------------------------------------------------------
  const fmt = (m: number) => `${m.toFixed(0)}m`;
  const stats = (xs: number[]) => {
    if (xs.length === 0) return 'n/a';
    const s = [...xs].sort((a, b) => a - b);
    return `median=${fmt(median(s))}  p90=${fmt(percentile(s, 90))}  max=${fmt(s[s.length - 1])}`;
  };

  console.log(`\n=== BTS estimation validation (signal-based) ==============`);
  console.log(`cells: ${results.length}   raw anchors: ${rows.length}   dedup grid: ${GRID_M}m\n`);

  console.log(`Top-K strongest estimator — error over ALL cells:`);
  for (const k of TOPK) {
    const label = k === 1 ? 'K=1 (strongest)' : `K=${k} (mean of top ${k})`;
    console.log(`  ${label.padEnd(22)} : ${stats(results.map((r) => r.errByK[k]))}`);
  }
  console.log();

  // The core hypothesis: stronger max signal ⇒ lower error.
  console.log(`Error (K=1 strongest) by MAX observed signal — the confidence axis:`);
  for (const b of DBM_BUCKETS) {
    const sub = results.filter((r) => r.maxDbm > b.lo && r.maxDbm <= b.hi);
    console.log(`  ${b.label.padEnd(18)} : cells=${String(sub.length).padStart(3)}  ${stats(sub.map((r) => r.errByK[1]))}`);
  }
  console.log();

  // Gate sweep by max dBm: how many cells qualify and how good they are.
  console.log(`Gate by max dBm (cells passing / K=1 error):`);
  for (const g of DBM_GATE_SWEEP) {
    const sub = results.filter((r) => r.maxDbm >= g);
    console.log(`  maxDbm >= ${String(g).padStart(4)} : cells=${String(sub.length).padStart(3)}  ${stats(sub.map((r) => r.errByK[1]))}`);
  }
  console.log();

  // per-cell detail, best (lowest K=1 error) first
  const ordered = [...results].sort((a, b) => a.errByK[1] - b.errByK[1]);
  console.log(`Per-cell (deduped):`);
  console.log(`  cell                      rawN  distinct  spread  maxDbm   errK1  errK3  errK5`);
  for (const r of ordered) {
    console.log(
      `  ${r.key.padEnd(24)} ${String(r.rawN).padStart(5)}  ${String(r.distinct).padStart(8)}  ${fmt(r.spread).padStart(6)}  ${String(r.maxDbm).padStart(5)}  ${fmt(r.errByK[1]).padStart(6)} ${fmt(r.errByK[3]).padStart(6)} ${fmt(r.errByK[5]).padStart(6)}`,
    );
  }
  console.log(`\n===========================================================\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
