import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class MapQueryDto {
  @ApiProperty({ example: 105.8 })
  @Type(() => Number)
  @IsLongitude()
  west: number;

  @ApiProperty({ example: 21.0 })
  @Type(() => Number)
  @IsLatitude()
  south: number;

  @ApiProperty({ example: 105.9 })
  @Type(() => Number)
  @IsLongitude()
  east: number;

  @ApiProperty({ example: 21.1 })
  @Type(() => Number)
  @IsLatitude()
  north: number;

  @ApiPropertyOptional({ example: 15, minimum: 0, maximum: 22 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(22)
  zoom?: number;
}
