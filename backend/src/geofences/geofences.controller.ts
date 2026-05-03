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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { GeofenceBreachEvent } from '../events/events.gateway';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssignDeviceDto } from './dto/assign-device.dto';
import { CreateGeofenceDto } from './dto/create-geofence.dto';
import { UpdateGeofenceDto } from './dto/update-geofence.dto';
import {
  GeofencesService,
  type GeofenceDetail,
  type GeofenceListItem,
} from './geofences.service';

@ApiTags('geofences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/geofences')
export class GeofencesController {
  constructor(private readonly geofencesService: GeofencesService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo vùng an toàn mới' })
  create(@Body() dto: CreateGeofenceDto): Promise<GeofenceDetail> {
    return this.geofencesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách vùng an toàn' })
  findAll(): Promise<GeofenceListItem[]> {
    return this.geofencesService.findAll();
  }

  @Get('breaches/active')
  @ApiOperation({
    summary: 'Danh sách thiết bị hiện đang ngoài vùng an toàn',
  })
  listActiveBreaches(): Promise<GeofenceBreachEvent[]> {
    return this.geofencesService.listActiveBreaches();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết vùng + thiết bị thuộc vùng' })
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GeofenceDetail> {
    return this.geofencesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật tên/tâm/bán kính' })
  @ApiOkResponse()
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateGeofenceDto,
  ): Promise<GeofenceDetail> {
    return this.geofencesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Xoá vùng (tự gỡ liên kết khỏi tất cả thiết bị)',
  })
  @ApiNoContentResponse()
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.geofencesService.remove(id);
  }

  @Post(':id/devices')
  @ApiOperation({ summary: 'Gán thiết bị vào vùng' })
  assignDevice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignDeviceDto,
  ): Promise<GeofenceDetail> {
    return this.geofencesService.assignDevice(id, dto.deviceId);
  }

  @Delete(':id/devices/:deviceId')
  @ApiOperation({ summary: 'Gỡ thiết bị khỏi vùng' })
  detachDevice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('deviceId', new ParseUUIDPipe()) deviceId: string,
  ): Promise<GeofenceDetail> {
    return this.geofencesService.detachDevice(id, deviceId);
  }
}
