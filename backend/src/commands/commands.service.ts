import {
  BadRequestException,
  ForbiddenException,
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

  async createCommand(
    deviceId: string,
    parentAccountId: string,
    dto: CreateCommandDto,
  ) {
    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: { id: true, parent_account_id: true },
    });
    if (!device) throw new NotFoundException('Device not found');
    if (device.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với thiết bị này');
    }

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

  async listForDevice(
    deviceId: string,
    parentAccountId: string,
    query: ListCommandsQueryDto,
  ) {
    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: { id: true, parent_account_id: true },
    });
    if (!device) throw new NotFoundException('Device not found');
    if (device.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với thiết bị này');
    }

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

  /**
   * HTTP polling endpoint cho mobile background — khi app ở background, JS
   * runtime bị suspend nên socket disconnect, không nhận được command. Mỗi
   * lần TaskManager headless wake để flush GPS, mobile gọi endpoint này để
   * lấy các command còn pending, ack ngay (mark delivered) trong cùng 1
   * round-trip để giảm RTT. Result vẫn POST riêng sau khi mobile execute
   * xong.
   *
   * Trade-off: nếu trẻ đứng yên >5p (cron timeout) thì command bị mark
   * failed trước khi background poll tới. Chấp nhận được vì foreground vẫn
   * realtime qua socket, và GPS thường có chuyển động nhỏ giữ poll chạy.
   */
  async pollPending(deviceId: string) {
    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device not found');

    const candidates = await this.prisma.device_commands.findMany({
      where: { device_id: deviceId, status: 'pending' },
      orderBy: { created_at: 'asc' },
    });
    if (candidates.length === 0) return { commands: [] };

    // Mark từng command nguyên tử bằng updateMany với điều kiện status còn
    // pending — nếu foreground socket đã ack mất giữa lúc ta findMany và
    // update, count sẽ = 0 và ta bỏ qua, tránh double-execute. Phải làm
    // per-row vì updateMany batch không nói được row nào đã skip.
    const now = new Date();
    const claimed = [];
    for (const c of candidates) {
      const r = await this.prisma.device_commands.updateMany({
        where: { id: c.id, status: 'pending' },
        data: { status: 'delivered', delivered_at: now },
      });
      if (r.count === 1) claimed.push(c);
    }

    for (const cmd of claimed) {
      this.clearTimeout(cmd.id);
      this.events.emitCommandStatusChanged({
        deviceId,
        commandId: cmd.id,
        status: 'delivered',
      });
    }

    return {
      commands: claimed.map((c) => ({
        commandId: c.id,
        command: c.command,
        payload: c.payload ?? {},
      })),
    };
  }

  /**
   * HTTP result endpoint cho mobile background. Verify command thuộc về
   * device (tránh device A report kết quả của device B), rồi delegate cho
   * handleResult — cùng path với socket result để giữ một nguồn sự thật.
   */
  async submitResultFromDevice(
    deviceId: string,
    commandId: string,
    success: boolean,
    error?: string | null,
  ): Promise<void> {
    const cmd = await this.prisma.device_commands.findUnique({
      where: { id: commandId },
      select: { device_id: true },
    });
    if (!cmd) throw new NotFoundException('Command not found');
    if (cmd.device_id !== deviceId) {
      throw new ForbiddenException('Command không thuộc thiết bị này');
    }
    await this.handleResult({ commandId, success, error });
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
