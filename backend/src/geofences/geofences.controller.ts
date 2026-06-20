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
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { GeofenceBreachEvent } from '../events/events.gateway';
import { JwtAuthGuard, type AuthedRequest } from '../auth/jwt-auth.guard';
import { AssignDeviceDto, SetDevicesDto } from './dto/assign-device.dto';
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
  @ApiOperation({ summary: 'Tạo vùng giám sát mới' })
  create(
    @Req() req: AuthedRequest,
    @Body() dto: CreateGeofenceDto,
  ): Promise<GeofenceDetail> {
    return this.geofencesService.create(req.managerAccount.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách vùng giám sát của người quản lý' })
  findAll(@Req() req: AuthedRequest): Promise<GeofenceListItem[]> {
    return this.geofencesService.findAll(req.managerAccount.sub);
  }

  @Get('breaches/active')
  @ApiOperation({
    summary: 'Danh sách thiết bị hiện đang ngoài vùng giám sát (của người quản lý)',
  })
  listActiveBreaches(@Req() req: AuthedRequest): Promise<GeofenceBreachEvent[]> {
    return this.geofencesService.listActiveBreaches(req.managerAccount.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết vùng + thiết bị thuộc vùng' })
  findOne(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GeofenceDetail> {
    return this.geofencesService.findOne(id, req.managerAccount.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật tên/tâm/bán kính' })
  update(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateGeofenceDto,
  ): Promise<GeofenceDetail> {
    return this.geofencesService.update(id, req.managerAccount.sub, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Xoá vùng (tự gỡ liên kết khỏi tất cả thiết bị)',
  })
  @ApiNoContentResponse()
  remove(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.geofencesService.remove(id, req.managerAccount.sub);
  }

  @Post(':id/devices')
  @ApiOperation({ summary: 'Gán 1 thiết bị vào vùng' })
  assignDevice(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignDeviceDto,
  ): Promise<GeofenceDetail> {
    return this.geofencesService.assignDevice(
      id,
      req.managerAccount.sub,
      dto.deviceId,
    );
  }

  @Put(':id/devices')
  @ApiOperation({ summary: 'Set list thiết bị thuộc vùng (replace toàn bộ)' })
  setDevices(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetDevicesDto,
  ): Promise<GeofenceDetail> {
    return this.geofencesService.setDevices(
      id,
      req.managerAccount.sub,
      dto.deviceIds,
    );
  }

  @Delete(':id/devices/:deviceId')
  @ApiOperation({ summary: 'Gỡ thiết bị khỏi vùng' })
  detachDevice(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('deviceId', new ParseUUIDPipe()) deviceId: string,
  ): Promise<GeofenceDetail> {
    return this.geofencesService.detachDevice(
      id,
      req.managerAccount.sub,
      deviceId,
    );
  }
}
