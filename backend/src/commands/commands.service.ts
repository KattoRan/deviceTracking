import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { EventsGateway } from '../events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMMANDS,
  type CommandName,
  CreateCommandDto,
  LockDevicePayloadDto,
  RingAlarmPayloadDto,
  ToggleTrackingPayloadDto,
} from './dto/create-command.dto';
import { ListCommandsQueryDto } from './dto/list-commands.dto';

const COMMAND_TIMEOUT_MS = 30_000;

type PayloadClass = new () => object;

const PAYLOAD_VALIDATORS: Record<CommandName, PayloadClass | null> = {
  request_location_now: null,
  ring_alarm: RingAlarmPayloadDto,
  toggle_tracking: ToggleTrackingPayloadDto,
  lock_device: LockDevicePayloadDto,
};

@Injectable()
export class CommandsService {
  private readonly logger = new Logger(CommandsService.name);
  private readonly timeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly events: EventsGateway,
  ) {}

  async createCommand(deviceId: string, dto: CreateCommandDto) {
    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device not found');

    if (!COMMANDS.includes(dto.command)) {
      throw new BadRequestException(`Unknown command: ${dto.command}`);
    }

    const payload = await this.validatePayload(dto.command, dto.payload);

    const row = await this.prisma.device_commands.create({
      data: {
        device_id: deviceId,
        command: dto.command,
        payload: payload as never,
        status: 'pending',
      },
      select: { id: true, status: true, created_at: true },
    });

    this.events.emitCommand(deviceId, {
      commandId: row.id,
      command: dto.command,
      payload: payload ?? {},
    });

    this.scheduleTimeout(row.id);

    this.logger.log(
      `Created command=${dto.command} id=${row.id} for device=${deviceId}`,
    );

    return {
      commandId: row.id,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  async listForDevice(deviceId: string, query: ListCommandsQueryDto) {
    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device not found');

    const where = {
      device_id: deviceId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.device_commands.count({ where }),
      this.prisma.device_commands.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: query.limit ?? 20,
        skip: query.offset ?? 0,
      }),
    ]);

    return {
      total,
      items: items.map((c) => ({
        id: c.id,
        command: c.command,
        payload: c.payload,
        status: c.status,
        createdAt: c.created_at,
        deliveredAt: c.delivered_at,
        executedAt: c.executed_at,
        error: c.error,
      })),
    };
  }

  async getById(commandId: string) {
    const c = await this.prisma.device_commands.findUnique({
      where: { id: commandId },
    });
    if (!c) throw new NotFoundException('Command not found');
    return {
      id: c.id,
      deviceId: c.device_id,
      command: c.command,
      payload: c.payload,
      status: c.status,
      createdAt: c.created_at,
      deliveredAt: c.delivered_at,
      executedAt: c.executed_at,
      error: c.error,
    };
  }

  async handleAck(commandId: string): Promise<void> {
    const existing = await this.prisma.device_commands.findUnique({
      where: { id: commandId },
      select: { status: true, device_id: true },
    });
    // Only flip pending→delivered; ignore acks that arrive after the server
    // already marked the command executed/failed (e.g. after a late retry).
    if (!existing || existing.status !== 'pending') return;

    await this.prisma.device_commands.update({
      where: { id: commandId },
      data: { status: 'delivered', delivered_at: new Date() },
    });
    this.events.emitCommandStatusChanged({
      deviceId: existing.device_id,
      commandId,
      status: 'delivered',
    });
  }

  async handleResult(params: {
    commandId: string;
    success: boolean;
    error?: string | null;
  }): Promise<void> {
    const existing = await this.prisma.device_commands.findUnique({
      where: { id: params.commandId },
      select: { status: true, device_id: true },
    });
    if (!existing || existing.status === 'executed' || existing.status === 'failed') {
      return;
    }

    this.clearTimeout(params.commandId);

    await this.prisma.device_commands.update({
      where: { id: params.commandId },
      data: {
        status: params.success ? 'executed' : 'failed',
        error: params.success ? null : (params.error ?? 'Unknown error'),
        executed_at: new Date(),
      },
    });
    this.events.emitCommandStatusChanged({
      deviceId: existing.device_id,
      commandId: params.commandId,
      status: params.success ? 'executed' : 'failed',
      error: params.success ? null : (params.error ?? null),
    });
  }

  private async validatePayload(
    command: CommandName,
    payload: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown> | null> {
    const cls = PAYLOAD_VALIDATORS[command];
    if (!cls) return null;

    const instance = plainToInstance(cls, payload ?? {});
    try {
      await validateOrReject(instance as object, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
    } catch (errors) {
      const msgs = Array.isArray(errors)
        ? errors.flatMap((e) => Object.values(e.constraints ?? {}))
        : ['Invalid payload'];
      throw new BadRequestException(msgs);
    }
    return instance as Record<string, unknown>;
  }

  private scheduleTimeout(commandId: string): void {
    const timer = setTimeout(() => {
      this.timeouts.delete(commandId);
      this.failIfStillPending(commandId).catch((err) =>
        this.logger.error(
          `timeout handler failed for ${commandId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }, COMMAND_TIMEOUT_MS);
    // unref() so a pending command doesn't keep the Node process alive on shutdown.
    timer.unref?.();
    this.timeouts.set(commandId, timer);
  }

  private clearTimeout(commandId: string): void {
    const t = this.timeouts.get(commandId);
    if (t) {
      clearTimeout(t);
      this.timeouts.delete(commandId);
    }
  }

  private async failIfStillPending(commandId: string): Promise<void> {
    const row = await this.prisma.device_commands.findUnique({
      where: { id: commandId },
      select: { status: true, device_id: true },
    });
    if (!row || row.status !== 'pending') return;

    await this.prisma.device_commands.update({
      where: { id: commandId },
      data: { status: 'failed', error: 'timeout', executed_at: new Date() },
    });
    this.events.emitCommandStatusChanged({
      deviceId: row.device_id,
      commandId,
      status: 'failed',
      error: 'timeout',
    });
  }
}
