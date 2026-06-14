import { Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SubmitDataDto } from './dto/submit-data.dto';
import { IngestService } from './ingest.service';

@ApiTags('ingest')
@Controller('api/v1/ingest')
export class IngestController {
  private readonly logger = new Logger(IngestController.name);
  constructor(private readonly ingestService: IngestService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Telemetry endpoint duy nhất (gộp ingest + heartbeat)',
    description:
      'Mobile gửi cả khi có lẫn không có fix GPS mới. locations non-empty → ' +
      'lưu location_history + emit device_moved. locations empty/omit → chỉ ' +
      'refresh last_seen + emit device_heartbeat.',
  })
  @ApiHeader({ name: 'x-device-id', required: true })
  ingest(
    @Body() dto: SubmitDataDto,
    @Headers('x-device-id') deviceId: string,
  ) {
    this.logger.log(`ingest deviceId=${deviceId} locations=${dto.locations?.length ?? 0} battery=${dto.batteryLevel ?? '-'}`);
    return this.ingestService.saveData(deviceId, dto);
  }
}
