import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Min } from 'class-validator';

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
}
