import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CellTowerDto } from './submit-data.dto';

/**
 * Tín hiệu "device còn sống" khi không có fix GPS mới (đứng yên, watcher
 * không emit). Khi đính kèm `cellTowers`, server thử cell-based positioning
 * (Combain) — thành công thì ingest như fix `network`-tier; thất bại rơi
 * về heartbeat thường (chỉ refresh last_seen + last_battery).
 */
export class HeartbeatDto {
  @ApiPropertyOptional({ example: 42, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  batteryLevel?: number;

  @ApiPropertyOptional({ type: [CellTowerDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CellTowerDto)
  cellTowers?: CellTowerDto[];
}
