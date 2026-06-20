import {
  BadRequestException,
  Body,
  Controller,
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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, type AuthedRequest } from '../auth/jwt-auth.guard';
import { CommandsService } from './commands.service';
import { CommandResponseDto, CreateCommandDto } from './dto/create-command.dto';
import { ListCommandsQueryDto } from './dto/list-commands.dto';
import { CommandResultDto } from './dto/command-result.dto';

@ApiTags('commands')
@Controller('api/v1')
export class CommandsController {
  constructor(private readonly commandsService: CommandsService) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Manager endpoints (JWT)
  // ──────────────────────────────────────────────────────────────────────────

  @Post('devices/:id/commands')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Gửi lệnh điều khiển tới thiết bị' })
  @ApiCreatedResponse({ type: CommandResponseDto })
  @ApiBadRequestResponse({ description: 'Command không hợp lệ hoặc payload sai' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy thiết bị' })
  createCommand(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateCommandDto,
  ) {
    return this.commandsService.createCommand(id, req.managerAccount.sub, dto);
  }

  @Get('devices/:id/commands')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lịch sử lệnh đã gửi cho thiết bị' })
  listForDevice(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListCommandsQueryDto,
  ) {
    return this.commandsService.listForDevice(id, req.managerAccount.sub, query);
  }

  @Get('commands/:commandId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Xem trạng thái 1 lệnh (polling)' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy lệnh' })
  getCommand(@Param('commandId', new ParseUUIDPipe()) commandId: string) {
    return this.commandsService.getById(commandId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Device endpoints (x-device-id) — dùng cho mobile background polling.
  // Pattern xác thực bằng header trùng với /api/v1/ingest, không cần JWT
  // vì mobile device không có account login.
  // ──────────────────────────────────────────────────────────────────────────

  @Post('devices/commands/poll')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'x-device-id', required: true })
  @ApiOperation({
    summary: 'Mobile pull pending commands (background fallback)',
    description:
      'Trả về tất cả command còn pending và đánh dấu delivered nguyên tử. ' +
      'Dùng từ headless TaskManager task khi socket đã disconnect.',
  })
  pollPending(@Headers('x-device-id') deviceId: string) {
    if (!deviceId) throw new BadRequestException('Missing x-device-id');
    return this.commandsService.pollPending(deviceId);
  }

  @Post('devices/commands/:commandId/result')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiHeader({ name: 'x-device-id', required: true })
  @ApiOperation({ summary: 'Mobile report kết quả thực thi command' })
  async submitResult(
    @Headers('x-device-id') deviceId: string,
    @Param('commandId', new ParseUUIDPipe()) commandId: string,
    @Body() dto: CommandResultDto,
  ): Promise<void> {
    if (!deviceId) throw new BadRequestException('Missing x-device-id');
    await this.commandsService.submitResultFromDevice(
      deviceId,
      commandId,
      dto.success,
      dto.error ?? null,
    );
  }
}
