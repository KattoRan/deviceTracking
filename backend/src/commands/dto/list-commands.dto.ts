import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const COMMAND_STATUSES = [
  'pending',
  'delivered',
  'executed',
  'failed',
] as const;

export class ListCommandsQueryDto {
  @ApiPropertyOptional({ enum: COMMAND_STATUSES })
  @IsOptional()
  @IsIn(COMMAND_STATUSES as readonly string[])
  status?: (typeof COMMAND_STATUSES)[number];

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
