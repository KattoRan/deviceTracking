import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Tín hiệu "device còn sống" khi không có fix GPS mới (đứng yên, watcher
 * không emit). Không insert location_history — chỉ refresh devices.last_seen
 * và xử lý low-battery transition như /ingest, nhưng nhẹ hơn.
 */
export class HeartbeatDto {
  @ApiPropertyOptional({ example: 42, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  batteryLevel?: number;
}
