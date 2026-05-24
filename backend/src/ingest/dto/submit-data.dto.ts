import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export const LOCATION_QUALITIES = ['gps', 'approx', 'network'] as const;
export type LocationQuality = (typeof LOCATION_QUALITIES)[number];

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

  @ApiProperty() @IsNumber() signalDbm: number;

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
}

export class SubmitDataDto {
  /**
   * Ordered oldest → newest. Every watcher fix observed during one send
   * window is shipped in one payload, so the server can reconstruct the
   * trajectory between ticks rather than only seeing the latest point.
   * Always at least one element — the mobile client falls back to the
   * last known fix as a single-element heartbeat when the user is still.
   */
  @ApiProperty({ type: [LocationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LocationDto)
  locations: LocationDto[];

  @ApiPropertyOptional({ type: [CellTowerDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CellTowerDto)
  cellTowers?: CellTowerDto[];

  /**
   * Pin thiết bị (0–100). Khi <20% và trước đó ≥20%, server bắn alert
   * low_battery + push notification cho phụ huynh.
   */
  @ApiPropertyOptional({ example: 42, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  batteryLevel?: number;
}
