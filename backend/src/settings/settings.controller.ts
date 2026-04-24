import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  TrackingIntervalResponseDto,
  UpdateTrackingIntervalDto,
} from './dto/tracking-interval.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('api/v1/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('tracking-interval')
  @ApiOperation({ summary: 'Lấy chu kỳ gửi telemetry chung cho tất cả thiết bị' })
  @ApiOkResponse({ type: TrackingIntervalResponseDto })
  getTrackingInterval() {
    return this.settingsService.getTrackingInterval();
  }

  @Put('tracking-interval')
  @ApiOperation({
    summary:
      'Đặt chu kỳ gửi chung cho tất cả thiết bị (5s / 30s / 60s). Broadcast qua socket để mobile cập nhật.',
  })
  @ApiOkResponse({ type: TrackingIntervalResponseDto })
  setTrackingInterval(@Body() dto: UpdateTrackingIntervalDto) {
    return this.settingsService.setTrackingInterval(dto.intervalSec);
  }
}
