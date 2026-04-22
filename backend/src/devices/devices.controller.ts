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
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DevicesService } from './devices.service';
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

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết thiết bị (chủ, vị trí, cell, BTS, khoảng cách)' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy thiết bị' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.devicesService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Hủy đăng ký thiết bị (cascade xoá lịch sử; xoá user nếu không còn thiết bị nào khác)',
  })
  @ApiNoContentResponse({ description: 'Đã xoá' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy thiết bị' })
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.devicesService.remove(id);
  }
}
