import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const LOCATION_QUALITIES = ['gps', 'approx', 'network'] as const;
export type LocationQuality = (typeof LOCATION_QUALITIES)[number];

export const ACTIVITIES = [
  'STILL',
  'WALKING',
  'RUNNING',
  'ON_BICYCLE',
  'IN_VEHICLE',
  'UNKNOWN',
] as const;
export type Activity = (typeof ACTIVITIES)[number];

export class LocationDto {
  @ApiProperty({ example: 21.028511 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ example: 105.804817 })
  @IsNumber()
  longitude: number;

  /**
   * Horizontal accuracy radius (68% confidence) reported by the OS, in
   * metres. Carries the raw value so the server can audit the client's
   * quality classification and reproduce it on different tier boundaries.
   */
  @ApiPropertyOptional({ example: 12.5 })
  @IsOptional()
  @IsNumber()
  accuracy?: number;

  /**
   * Quality tier assigned on the device based on `accuracy`. Drives the
   * "consumer decides" policy on the server side: only `gps` feeds the
   * polyline and geofence checks; `approx`/`network` keep `last_seen`
   * alive and let the dashboard render a dimmed marker.
   */
  @ApiPropertyOptional({ enum: LOCATION_QUALITIES })
  @IsOptional()
  @IsIn(LOCATION_QUALITIES as readonly string[])
  quality?: LocationQuality;

  /**
   * Epoch ms when the fix was produced on the device. Carried through
   * batched payloads so we can persist the actual trajectory order/spacing
   * instead of stamping every fix with `received_at`.
   */
  @ApiProperty({ example: 1731000000000 })
  @IsInt()
  timestamp: number;
}

export class CellTowerDto {
  @ApiProperty({ example: 'LTE' })
  @IsString()
  type: string;

  @ApiProperty() @IsInt() mcc: number;
  @ApiProperty() @IsInt() mnc: number;
  @ApiProperty() @IsInt() lac: number;
  @ApiProperty() @IsInt() cid: number;

  // Nullable: a modem may report a cell's identity but no usable signal
  // (e.g. WCDMA with no RSCP). Such cells are still accepted for BTS lookup.
  @ApiPropertyOptional() @IsOptional() @IsNumber() signalDbm?: number | null;

  @ApiPropertyOptional() @IsOptional() @IsInt() rssi?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() pci?: number;

  /**
   * From `android.telephony.CellInfo.isRegistered`. When present, the
   * serving-cell picker prefers it over signal strength. Missing on iOS
   * and when telemetry comes from older mobile builds.
   */
  @ApiPropertyOptional({
    description:
      'True iff the modem is currently registered on this cell (ground truth from OS).',
  })
  @IsOptional()
  @IsBoolean()
  isRegistered?: boolean;

  /**
   * `CellInfo.getCellConnectionStatus() === CONNECTION_PRIMARY_SERVING`
   * (Android API 28+). Đáng tin hơn `isRegistered` (chỉ một cell duy nhất
   * là PRIMARY tại 1 thời điểm). Khi có, serving-cell picker dùng làm bước
   * ưu tiên cao nhất trước khi xét tech rank + signal.
   */
  @ApiPropertyOptional({
    description:
      'True iff this is the modem`s PRIMARY_SERVING cell (single source of truth on Android 9+).',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/**
 * Unified telemetry payload. Mobile gửi cùng endpoint cả khi có lẫn không có
 * fix GPS mới.
 *
 *   - `locations` non-empty → server lưu location_history, emit `device_moved`.
 *   - `locations` empty/omit → server chỉ refresh last_seen + emit `device_heartbeat`.
 */
export class SubmitDataDto {
  /**
   * Ordered oldest → newest fix GPS trong cửa sổ gửi. Có thể empty/omit nếu
   * không có fix mới (user đứng yên hoặc mất GPS) — server xử lý như
   * heartbeat-only.
   */
  @ApiPropertyOptional({ type: [LocationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocationDto)
  locations?: LocationDto[];

  @ApiPropertyOptional({ type: [CellTowerDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CellTowerDto)
  cellTowers?: CellTowerDto[];

  /**
   * Pin thiết bị (0–100). Khi <20% và trước đó ≥20%, server bắn alert
   * low_battery qua Socket.IO cho người quản lý.
   */
  @ApiPropertyOptional({ example: 42, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  batteryLevel?: number;

  /**
   * Epoch ms của fix GPS gần nhất mobile có (kể cả không gửi vì gating
   * movement). Server forward qua socket event → FE biết "GPS có hoạt động
   * không" chính xác, không bị false positive khi user đứng yên.
   */
  @ApiPropertyOptional({ example: 1731000000000 })
  @IsOptional()
  @IsInt()
  lastFixAt?: number;

  /**
   * Activity recognition từ Google ML model phân loại trạng thái user
   * (STILL / WALKING / RUNNING / ON_BICYCLE / IN_VEHICLE). Mobile gửi kèm
   * mỗi telemetry để FE hiện icon + history page color-code segments.
   */
  @ApiPropertyOptional({ enum: ACTIVITIES })
  @IsOptional()
  @IsIn(ACTIVITIES as readonly string[])
  activity?: Activity;

  /** Confidence 0-100 của ML model cho activity nói trên. */
  @ApiPropertyOptional({ example: 85, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  activityConfidence?: number;
}
