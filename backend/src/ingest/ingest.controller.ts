import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { SubmitDataDto } from './dto/submit-data.dto';
import { IngestService } from './ingest.service';

@ApiTags('ingest')
@Controller('api/v1/ingest')
export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HTTP fallback nhận telemetry (thay thế MQTT)' })
  @ApiHeader({ name: 'x-device-id', required: true })
  ingest(
    @Body() dto: SubmitDataDto,
    @Headers('x-device-id') deviceId: string,
  ) {
    return this.ingestService.saveData(deviceId, dto);
  }

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Heartbeat khi device đứng yên',
    description:
      'Mobile gọi mỗi tick khi watcher không emit fix mới. Chỉ refresh ' +
      'last_seen + last_battery, không insert location_history.',
  })
  @ApiHeader({ name: 'x-device-id', required: true })
  heartbeat(
    @Body() dto: HeartbeatDto,
    @Headers('x-device-id') deviceId: string,
  ) {
    return this.ingestService.heartbeat(deviceId, dto);
  }
}
