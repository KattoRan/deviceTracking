import {
  Body,
  Controller,
  Get,
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
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, type AuthedRequest } from '../auth/jwt-auth.guard';
import { CommandsService } from './commands.service';
import { CommandResponseDto, CreateCommandDto } from './dto/create-command.dto';
import { ListCommandsQueryDto } from './dto/list-commands.dto';

@ApiTags('commands')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1')
export class CommandsController {
  constructor(private readonly commandsService: CommandsService) {}

  @Post('devices/:id/commands')
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
    return this.commandsService.createCommand(id, req.parentAccount.sub, dto);
  }

  @Get('devices/:id/commands')
  @ApiOperation({ summary: 'Lịch sử lệnh đã gửi cho thiết bị' })
  listForDevice(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListCommandsQueryDto,
  ) {
    return this.commandsService.listForDevice(id, req.parentAccount.sub, query);
  }

  @Get('commands/:commandId')
  @ApiOperation({ summary: 'Xem trạng thái 1 lệnh (polling)' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy lệnh' })
  getCommand(@Param('commandId', new ParseUUIDPipe()) commandId: string) {
    return this.commandsService.getById(commandId);
  }
}
