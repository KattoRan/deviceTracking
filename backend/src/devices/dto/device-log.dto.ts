import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export class DeviceLogDto {
  @ApiProperty({ enum: LOG_LEVELS })
  @IsIn(LOG_LEVELS as readonly string[])
  level: LogLevel;

  @ApiProperty({ example: 'NativeIngest failed' })
  @IsString()
  @MaxLength(500)
  message: string;

  /** Optional JSON context — stack trace, request body, etc. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
