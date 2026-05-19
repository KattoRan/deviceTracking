import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Min } from 'class-validator';

export const HISTORY_QUALITY_MODES = ['gps', 'gps_approx', 'all'] as const;
export type HistoryQualityMode = (typeof HISTORY_QUALITY_MODES)[number];

export class HistoryQueryDto {
  @ApiPropertyOptional({
    description: 'ISO 8601. Mặc định: đầu ngày hôm nay',
    example: '2026-04-29T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601. Mặc định: now',
    example: '2026-04-29T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    description:
      'Bỏ qua các điểm cách điểm trước đó dưới N mét (giảm tải khi dữ liệu dày).',
    example: 5,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minDistanceMeters?: number;

  /**
   * "Consumer decides" — caller picks the quality tier its UI needs:
   *   gps        → only GNSS-grade fixes (≤20m). Mặc định. Polyline sạch.
   *   gps_approx → kèm thêm fix degraded GPS (≤80m). Trail dày hơn nhưng
   *                vẫn loại fix WiFi/cell.
   *   all        → mọi fix đã được ingest (kể cả network ≤200m). Dùng cho
   *                debug hoặc xem coverage indoor.
   *
   * Rows persisted before this column existed (`quality` IS NULL) đều được
   * giữ ở mọi mode — tránh đoạn lịch sử cũ biến mất sau migration.
   */
  @ApiPropertyOptional({ enum: HISTORY_QUALITY_MODES, default: 'gps' })
  @IsOptional()
  @IsIn(HISTORY_QUALITY_MODES as readonly string[])
  quality?: HistoryQualityMode;
}
