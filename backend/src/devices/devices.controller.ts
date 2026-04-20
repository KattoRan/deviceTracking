import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
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
}
