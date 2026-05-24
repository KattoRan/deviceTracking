import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, type AuthedRequest } from '../auth/jwt-auth.guard';
import { SubscribePushDto, UnsubscribePushDto } from './dto/subscribe.dto';
import { PushService } from './push.service';

@ApiTags('push')
@Controller('api/v1/push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('public-key')
  @ApiOperation({ summary: 'VAPID public key (cho client subscribe)' })
  getPublicKey(): { key: string | null } {
    return { key: this.pushService.getPublicKey() };
  }

  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đăng ký endpoint Web Push của browser cho phụ huynh' })
  subscribe(@Req() req: AuthedRequest, @Body() dto: SubscribePushDto) {
    return this.pushService.subscribe(req.parentAccount.sub, dto);
  }

  @Delete('subscribe')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Huỷ đăng ký endpoint (khi user disable notification)' })
  unsubscribe(@Req() req: AuthedRequest, @Body() dto: UnsubscribePushDto) {
    return this.pushService.unsubscribe(req.parentAccount.sub, dto.endpoint);
  }
}
