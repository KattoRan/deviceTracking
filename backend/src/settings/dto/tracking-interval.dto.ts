import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt } from 'class-validator';

export const TRACKING_INTERVAL_CHOICES = [5, 30, 60] as const;
export type TrackingIntervalSec = (typeof TRACKING_INTERVAL_CHOICES)[number];

export class UpdateTrackingIntervalDto {
  @ApiProperty({ enum: TRACKING_INTERVAL_CHOICES, example: 30 })
  @IsInt()
  @IsIn(TRACKING_INTERVAL_CHOICES as readonly number[])
  intervalSec: TrackingIntervalSec;
}

export class TrackingIntervalResponseDto {
  @ApiProperty({ example: 30 })
  intervalSec: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}
