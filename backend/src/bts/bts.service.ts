import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { MapQueryDto } from './dto/map-query.dto';

interface CombainResponse {
  location?: { lat?: number; lng?: number };
  accuracy?: number;
  logId?: number;
  error?: { code?: number; message?: string };
}

interface ClusterRow {
  lat: number;
  lon: number;
  count: number;
}

interface BtsRow {
  id: number;
  lat: number;
  lon: number;
  radio: string | null;
  range: number | null;
}

const CACHE_TTL_SECONDS = 60;
const RAW_LIMIT = 2000;
const CLUSTER_LIMIT = 5000;
// TTL cho cache cell-locate. User mất GPS thường đứng yên indoor → cùng set
// cells lặp lại liên tục, cache giúp giảm từ ~120 call/h xuống ~6 call/h
// trên tick 30s. 10 phút đủ để tránh dữ liệu stale nếu user thực sự dịch
// chuyển nhưng vẫn thấy cùng cells (hiếm vì cell coverage ~vài km).
const LOCATE_CACHE_TTL_SECONDS = 600;

/**
 * Fingerprint cells theo identity tuple (mcc-mnc-lac-cid), sort lexicographic
 * để 2 mảng cùng set nhưng khác thứ tự cho ra cùng key. Bỏ qua signalDbm vì
 * tín hiệu biến động liên tục mà không đổi vị trí thực.
 */
function fingerprintCells(
  cells: Array<{ mcc: number; mnc: number; lac: number; cid: number }>,
): string {
  return cells
    .map((c) => `${c.mcc}-${c.mnc}-${c.lac}-${c.cid}`)
    .sort()
    .join(',');
}

@Injectable()
export class BtsService {
  private readonly logger = new Logger(BtsService.name);

  /** Dedup in-flight lookups so concurrent telemetry for the same cell only
   *  hits Combain once — saves quota and avoids unique-constraint races. */
  private readonly inflight = new Map<
    string,
    Promise<Awaited<ReturnType<BtsService['fetchAndInsert']>>>
  >();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getOrFetchStation(
    mcc: number,
    mnc: number,
    lac: number,
    cid: number,
    radio = 'lte',
  ) {
    const existing = await this.prisma.bts_stations.findUnique({
      where: { mcc_mnc_lac_cid: { mcc, mnc, lac, cid } },
    });
    if (existing) return existing;

    const key = `${mcc}-${mnc}-${lac}-${cid}`;
    const inflight = this.inflight.get(key);
    if (inflight) return inflight;

    const promise = this.fetchAndInsert(mcc, mnc, lac, cid, radio).finally(() =>
      this.inflight.delete(key),
    );
    this.inflight.set(key, promise);
    return promise;
  }

  private async fetchAndInsert(
    mcc: number,
    mnc: number,
    lac: number,
    cid: number,
    radio: string,
  ) {
    const key = process.env.COMBAIN_API_KEY;
    const combainUrl = process.env.COMBAIN_URL;
    if (!key) {
      this.logger.debug('COMBAIN_API_KEY missing — skip lookup');
      return null;
    }
    if (!combainUrl) {
      this.logger.debug('COMBAIN_URL missing — skip lookup');
      return null;
    }

    let data: CombainResponse;
    try {
      const res = await axios.post<CombainResponse>(
        combainUrl,
        {
          radioType: radio,
          cellTowers: [
            {
              mobileCountryCode: mcc,
              mobileNetworkCode: mnc,
              locationAreaCode: lac,
              cellId: cid,
            },
          ],
        },
        { params: { key }, timeout: 8000 },
      );
      data = res.data;
    } catch (err) {
      this.logger.warn(
        `Combain request ${mcc}-${mnc}-${lac}-${cid} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    const lat = data.location?.lat;
    const lng = data.location?.lng;
    if (data.error || lat == null || lng == null) {
      this.logger.warn(
        `Combain no fix for ${mcc}-${mnc}-${lac}-${cid}: ${data.error?.message ?? 'no data'}`,
      );
      return null;
    }

    // The `set_geom` trigger auto-populates `geom` from lat/lon on INSERT.
    // Raw SQL with ON CONFLICT is atomic — Prisma's upsert isn't and races
    // with other queue workers reading the same cell. Combain returns
    // `accuracy` (estimated error radius), not coverage range, and no
    // address — the address column stays null for rows ingested this way.
    await this.prisma.$executeRaw`
      INSERT INTO bts_stations (mcc, mnc, lac, cid, lat, lon, radio, range, address)
      VALUES (${mcc}, ${mnc}, ${lac}, ${cid}, ${lat}, ${lng}, ${radio}, ${data.accuracy ?? 0}, ${null})
      ON CONFLICT (mcc, mnc, lac, cid) DO NOTHING;
    `;

    return this.prisma.bts_stations.findUnique({
      where: { mcc_mnc_lac_cid: { mcc, mnc, lac, cid } },
    });
  }

  /**
   * Cell-based positioning fallback dùng khi mobile mất GPS hoàn toàn.
   *
   * Combain endpoint cùng `fetchAndInsert` dùng nhưng truyền N cell (serving
   * + neighbors) + signalStrength → API triangulate ra vị trí device kèm
   * accuracy. Caller cần đối xử kết quả này như fix tier `network` (drift
   * thường vài trăm m → vài km), KHÔNG dùng để eval geofence.
   *
   * Trả về null nếu thiếu API key/URL, mảng cells rỗng, hoặc Combain không
   * trả được fix — caller nên fall back về heartbeat thường.
   */
  async locateFromCells(
    cells: Array<{
      mcc: number;
      mnc: number;
      lac: number;
      cid: number;
      signalDbm?: number | null;
      type?: string | null;
    }>,
    fallbackRadio = 'lte',
  ): Promise<{ lat: number; lon: number; accuracy: number } | null> {
    if (cells.length === 0) return null;

    // Cache fingerprint trước khi check env — cache hit thì kể cả không có
    // API key (vd sau khi xoay key, deploy mới) ta vẫn trả result từ tick
    // cũ trong cửa sổ TTL → mượt cho user, không ép họ đợi.
    const cacheKey = `bts:locate:${fingerprintCells(cells)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as {
          lat: number;
          lon: number;
          accuracy: number;
        };
      } catch {
        // payload cũ malformed (vd thay schema) — fall through và refetch
      }
    }

    const key = process.env.COMBAIN_API_KEY;
    const combainUrl = process.env.COMBAIN_URL;
    if (!key || !combainUrl) return null;

    // Combain chỉ nhận một `radioType` cho cả request → lấy theo cell đầu
    // (thường là serving cell sau khi caller đã sort/filter). Fallback `lte`
    // vì đó là tech phổ biến nhất ở VN.
    const radio = (cells[0].type || fallbackRadio).toLowerCase();
    const cellTowers = cells.map((c) => {
      const tower: {
        mobileCountryCode: number;
        mobileNetworkCode: number;
        locationAreaCode: number;
        cellId: number;
        signalStrength?: number;
      } = {
        mobileCountryCode: c.mcc,
        mobileNetworkCode: c.mnc,
        locationAreaCode: c.lac,
        cellId: c.cid,
      };
      if (typeof c.signalDbm === 'number') tower.signalStrength = c.signalDbm;
      return tower;
    });

    let data: CombainResponse;
    try {
      const res = await axios.post<CombainResponse>(
        combainUrl,
        { radioType: radio, cellTowers },
        { params: { key }, timeout: 8000 },
      );
      data = res.data;
    } catch (err) {
      this.logger.warn(
        `Combain locate (${cellTowers.length} cells) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    const lat = data.location?.lat;
    const lng = data.location?.lng;
    if (data.error || lat == null || lng == null) {
      this.logger.debug(
        `Combain locate no fix from ${cellTowers.length} cells: ${data.error?.message ?? 'no data'}`,
      );
      return null;
    }
    // accuracy có thể null khi Combain confidence thấp — gán fallback rộng
    // 5km để FE biết đây là fix gần đúng, KHÔNG GPS-grade.
    const result = { lat, lon: lng, accuracy: data.accuracy ?? 5000 };
    // Chỉ cache success — fail không cache để tick kế tiếp được retry ngay
    // (vd Combain transient 5xx hoặc API hết quota tạm thời).
    await this.redis.setex(
      cacheKey,
      LOCATE_CACHE_TTL_SECONDS,
      JSON.stringify(result),
    );
    return result;
  }

  async getForMap(query: MapQueryDto) {
    const { west, south, east, north } = query;
    const zoom = query.zoom ?? 15;

    const cacheKey = `bts:map:${west.toFixed(5)},${south.toFixed(5)},${east.toFixed(5)},${north.toFixed(5)},${zoom}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const result =
      zoom < 13
        ? await this.getCluster(west, south, east, north, zoom)
        : await this.getRawBts(west, south, east, north);

    await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
    return result;
  }

  async getDetail(id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      throw new NotFoundException(`BTS with id ${id} not found`);
    }

    const bts = await this.prisma.bts_stations.findUnique({
      where: { id },
      select: {
        id: true,
        mcc: true,
        mnc: true,
        lac: true,
        cid: true,
        lat: true,
        lon: true,
        radio: true,
        range: true,
        address: true,
      },
    });
    if (!bts) throw new NotFoundException(`BTS with id ${id} not found`);
    return bts;
  }

  private async getCluster(
    west: number,
    south: number,
    east: number,
    north: number,
    zoom: number,
  ) {
    const gridSize = Math.max(0.005, 0.01 * (13 - zoom));
    const rows = await this.prisma.$queryRaw<ClusterRow[]>`
      SELECT
        ST_Y(ST_Centroid(ST_Collect(geom))) AS lat,
        ST_X(ST_Centroid(ST_Collect(geom))) AS lon,
        COUNT(*)::int AS count
      FROM bts_stations
      WHERE geom && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
      GROUP BY ST_SnapToGrid(geom, ${gridSize})
      ORDER BY count DESC
      LIMIT ${CLUSTER_LIMIT};
    `;
    return {
      type: 'FeatureCollection' as const,
      features: rows.map((row) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [row.lon, row.lat] },
        properties: { type: 'cluster', count: row.count },
      })),
    };
  }

  private async getRawBts(
    west: number,
    south: number,
    east: number,
    north: number,
  ) {
    const [countRow] = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM bts_stations
      WHERE geom && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326);
    `;
    const total = Number(countRow?.count ?? 0);

    const rows = await this.prisma.$queryRaw<BtsRow[]>`
      SELECT id, lat, lon, radio, range
      FROM bts_stations
      WHERE geom && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
      LIMIT ${RAW_LIMIT};
    `;

    return {
      type: 'FeatureCollection' as const,
      features: rows.map((row) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [Number(row.lon), Number(row.lat)] },
        properties: {
          type: 'bts',
          id: row.id,
          radio: row.radio,
          coverageRadius: row.range,
        },
      })),
      meta: { truncated: total > RAW_LIMIT, total, displayed: rows.length },
    };
  }
}
