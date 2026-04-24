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
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CommandsService } from './commands.service';
import { CommandResponseDto, CreateCommandDto } from './dto/create-command.dto';
import { ListCommandsQueryDto } from './dto/list-commands.dto';

@ApiTags('commands')
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
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateCommandDto,
  ) {
    return this.commandsService.createCommand(id, dto);
  }

  @Get('devices/:id/commands')
  @ApiOperation({ summary: 'Lịch sử lệnh đã gửi cho thiết bị' })
  listForDevice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListCommandsQueryDto,
  ) {
    return this.commandsService.listForDevice(id, query);
  }

  @Get('commands/:commandId')
  @ApiOperation({ summary: 'Xem trạng thái 1 lệnh (polling)' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy lệnh' })
  getCommand(@Param('commandId', new ParseUUIDPipe()) commandId: string) {
    return this.commandsService.getById(commandId);
  }
}
