import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const COMMANDS = [
  'request_location_now',
  'ring_alarm',
  'toggle_tracking',
  'lock_device',
] as const;

export type CommandName = (typeof COMMANDS)[number];

export class RingAlarmPayloadDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 60, default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  durationSec?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, default: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  volume?: number;
}

export class ToggleTrackingPayloadDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class LockDevicePayloadDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;
}

// Payload shape varies by command, so we keep it as an opaque object at the
// DTO layer and let CommandsService.validatePayload() run the per-command
// class-validator check. If we pinned a class with @ValidateNested here, the
// global pipe's `forbidNonWhitelisted` would reject every concrete payload.
export class CreateCommandDto {
  @ApiProperty({ enum: COMMANDS })
  @IsIn(COMMANDS as readonly string[])
  command: CommandName;

  @ApiPropertyOptional({ description: 'Shape depends on command.' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class CommandResponseDto {
  @ApiProperty({ format: 'uuid' })
  commandId: string;

  @ApiProperty({ enum: ['pending', 'delivered', 'executed', 'failed'] })
  status: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}
