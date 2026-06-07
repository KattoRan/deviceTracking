import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, type AuthedRequest } from '../auth/jwt-auth.guard';
import {
  TriggerSosDto,
  TriggerSosResponseDto,
} from './dto/trigger-sos.dto';
import { SosService } from './sos.service';

@ApiTags('sos')
@Controller('api/v1')
export class SosController {
  constructor(private readonly sosService: SosService) {}

  @Post('devices/sos')
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({
    name: 'x-device-id',
    required: true,
    description: 'Device UUID lưu trên mobile sau pair',
  })
  @ApiOperation({
    summary:
      'Mobile bấm SOS: lưu event + emit socket + push notification cho phụ huynh',
  })
  @ApiCreatedResponse({ type: TriggerSosResponseDto })
  trigger(
    @Headers('x-device-id') deviceId: string,
    @Body() dto: TriggerSosDto,
  ): Promise<TriggerSosResponseDto> {
    return this.sosService.trigger(deviceId, dto);
  }

  @Get('sos')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lịch sử SOS của phụ huynh (mới nhất trước)' })
  list(
    @Req() req: AuthedRequest,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50;
    return this.sosService.listForParent(req.parentAccount.sub, parsed);
  }

  @Post('sos/:id/ack')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xác nhận đã xử lý SOS event' })
  acknowledge(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.sosService.acknowledge(id, req.parentAccount.sub);
  }

  @Post('sos/ack-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đánh dấu tất cả SOS chưa xử lý của parent này là đã xử lý',
  })
  acknowledgeAll(@Req() req: AuthedRequest): Promise<{ count: number }> {
    return this.sosService.acknowledgeAll(req.parentAccount.sub);
  }

  @Delete('sos/acknowledged')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xoá vĩnh viễn lịch sử SOS đã xử lý (giữ event chưa xử lý)',
  })
  deleteAcknowledged(@Req() req: AuthedRequest): Promise<{ count: number }> {
    return this.sosService.deleteAcknowledged(req.parentAccount.sub);
  }
}
