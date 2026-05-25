import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard, type AuthedRequest } from '../auth/jwt-auth.guard';
import type { GeofenceBreachEvent } from '../events/events.gateway';
import { DevicesService } from './devices.service';
import { HistoryQueryDto } from './dto/history-query.dto';
import {
  PairDeviceDto,
  PairDeviceResponseDto,
} from './dto/pair-device.dto';

@ApiTags('devices')
@Controller('api/v1/devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('pair')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Mobile: pair thiết bị mới bằng pairing code phụ huynh cung cấp + thông tin người được giám sát',
  })
  @ApiCreatedResponse({ type: PairDeviceResponseDto })
  @ApiUnauthorizedResponse({ description: 'Pairing code không hợp lệ' })
  pair(@Body() dto: PairDeviceDto): Promise<PairDeviceResponseDto> {
    return this.devicesService.pair(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Danh sách thiết bị của phụ huynh' })
  findAll(@Req() req: AuthedRequest) {
    return this.devicesService.findAll(req.parentAccount.sub);
  }

  @Get(':id/history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lịch sử di chuyển trong khoảng [from, to] (mặc định: hôm nay → now)',
  })
  @ApiNotFoundResponse({ description: 'Không tìm thấy thiết bị' })
  getHistory(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: HistoryQueryDto,
  ) {
    return this.devicesService.getLocationHistory(
      id,
      req.parentAccount.sub,
      query.from,
      query.to,
      query.minDistanceMeters,
      query.quality,
    );
  }

  @Get(':id/active-breach')
  @ApiOperation({
    summary:
      'Trạng thái cảnh báo ra khỏi vùng giám sát hiện tại của thiết bị (null nếu trong vùng)',
  })
  getActiveBreach(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GeofenceBreachEvent | null> {
    return this.devicesService.getActiveBreach(id);
  }

  @Get(':id/parent-contact')
  @ApiOperation({
    summary:
      'Thông tin liên lạc của phụ huynh sở hữu thiết bị (tên + sđt). Dùng để hiển thị trên app mobile.',
  })
  @ApiNotFoundResponse({ description: 'Không tìm thấy thiết bị' })
  getParentContact(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ displayName: string | null; phoneNumber: string | null }> {
    return this.devicesService.getParentContact(id);
  }

  @Get(':id/lock-status')
  @ApiOperation({ summary: 'Trạng thái khóa của thiết bị (dùng cho mobile app)' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy thiết bị' })
  getLockStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.devicesService.getLockStatus(id);
  }

  @Patch(':id/lock')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Khóa / mở khóa thiết bị (phụ huynh)' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy thiết bị' })
  setLockStatus(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { locked: boolean },
  ) {
    return this.devicesService.setLockStatus(id, req.parentAccount.sub, body.locked);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Chi tiết thiết bị (vị trí, cell, BTS, geofences, khoảng cách)' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy thiết bị' })
  findOne(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.devicesService.findOne(id, req.parentAccount.sub);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Phụ huynh huỷ pair thiết bị (cascade xoá lịch sử)' })
  @ApiNoContentResponse({ description: 'Đã xoá' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy thiết bị' })
  remove(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.devicesService.remove(id, req.parentAccount.sub);
  }
}
