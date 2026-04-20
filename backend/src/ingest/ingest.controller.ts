import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
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
}
