import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { GeofenceBreachEvent } from '../events/events.gateway';
import { DevicesService } from './devices.service';
import { HistoryQueryDto } from './dto/history-query.dto';
import { RegisterDeviceDto, RegisterDeviceResponseDto } from './dto/register-device.dto';

@ApiTags('devices')
@Controller('api/v1/devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Đăng ký người dùng và thiết bị mới' })
  @ApiCreatedResponse({ type: RegisterDeviceResponseDto })
  @ApiConflictResponse({ description: 'Email / CCCD / số điện thoại đã tồn tại' })
  register(@Body() dto: RegisterDeviceDto): Promise<RegisterDeviceResponseDto> {
    return this.devicesService.register(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách thiết bị kèm vị trí & BTS mới nhất' })
  findAll() {
    return this.devicesService.findAll();
  }

  @Get(':id/history')
  @ApiOperation({
    summary: 'Lịch sử di chuyển trong khoảng [from, to] (mặc định: hôm nay → now)',
  })
  @ApiNotFoundResponse({ description: 'Không tìm thấy thiết bị' })
  getHistory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: HistoryQueryDto,
  ) {
    return this.devicesService.getLocationHistory(
      id,
      query.from,
      query.to,
      query.minDistanceMeters,
      query.quality,
    );
  }

  @Get(':id/active-breach')
  @ApiOperation({
    summary:
      'Trạng thái vi phạm vùng giám sát hiện tại của thiết bị (null nếu trong vùng)',
  })
  getActiveBreach(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GeofenceBreachEvent | null> {
    return this.devicesService.getActiveBreach(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết thiết bị (chủ, vị trí, cell, BTS, khoảng cách)' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy thiết bị' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.devicesService.findOne(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Admin huỷ đăng ký thiết bị (cascade xoá lịch sử; xoá user nếu không còn thiết bị nào khác)',
  })
  @ApiNoContentResponse({ description: 'Đã xoá' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy thiết bị' })
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.devicesService.remove(id);
  }
}
