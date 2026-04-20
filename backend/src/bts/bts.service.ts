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

interface UnwiredLabsResponse {
  status?: 'ok' | 'error';
  lat?: number;
  lon?: number;
  accuracy?: number;
  range?: number;
  address?: string;
  message?: string;
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
const UNWIRED_LABS_URL = 'https://us1.unwiredlabs.com/v2/process.php';

@Injectable()
export class BtsService {
  private readonly logger = new Logger(BtsService.name);

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

    const token = process.env.OPENCELLID_API_KEY;
    if (!token) {
      this.logger.debug('OPENCELLID_API_KEY missing — skip lookup');
      return null;
    }

    try {
      const res = await axios.post<UnwiredLabsResponse>(
        UNWIRED_LABS_URL,
        { token, radio, mcc, mnc, cells: [{ lac, cid }], address: 1 },
        { timeout: 8000 },
      );
      const data = res.data;
      if (data.status !== 'ok' || data.lat == null || data.lon == null) {
        this.logger.warn(
          `UnwiredLabs no fix for ${mcc}-${mnc}-${lac}-${cid}: ${data.message ?? 'no data'}`,
        );
        return null;
      }

      // The `set_geom` trigger auto-populates `geom` from lat/lon on INSERT.
      await this.prisma.bts_stations.upsert({
        where: { mcc_mnc_lac_cid: { mcc, mnc, lac, cid } },
        create: {
          mcc,
          mnc,
          lac,
          cid,
          lat: data.lat,
          lon: data.lon,
          radio,
          range: data.accuracy ?? data.range ?? 0,
          address: data.address ?? null,
        },
        update: {},
      });

      return this.prisma.bts_stations.findUnique({
        where: { mcc_mnc_lac_cid: { mcc, mnc, lac, cid } },
      });
    } catch (err) {
      this.logger.error(
        `UnwiredLabs error ${mcc}-${mnc}-${lac}-${cid}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
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
