import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import {
  TriggerSosDto,
  TriggerSosResponseDto,
} from './dto/trigger-sos.dto';

@Injectable()
export class SosService {
  private readonly logger = new Logger(SosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  async trigger(
    deviceId: string,
    dto: TriggerSosDto,
  ): Promise<TriggerSosResponseDto> {
    if (!deviceId) throw new BadRequestException('Missing device id');

    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: {
        id: true,
        manager_account_id: true,
        owner_name: true,
      },
    });
    if (!device) throw new NotFoundException('Device not found');

    const event = await this.prisma.sos_events.create({
      data: {
        device_id: deviceId,
        manager_account_id: device.manager_account_id,
        lat: dto.lat,
        lon: dto.lon,
        accuracy_m: dto.accuracy ?? null,
        battery_level: dto.batteryLevel ?? null,
      },
    });

    this.logger.warn(
      `🆘 SOS device=${deviceId} (${device.owner_name}) ` +
        `pos=(${dto.lat},${dto.lon}) battery=${dto.batteryLevel ?? '?'}%`,
    );

    this.events.emitSosAlert({
      sosEventId: event.id,
      deviceId,
      deviceName: device.owner_name,
      lat: dto.lat,
      lon: dto.lon,
      accuracy: dto.accuracy ?? null,
      batteryLevel: dto.batteryLevel ?? null,
      triggeredAt: event.triggered_at.toISOString(),
    });

    return {
      sosEventId: event.id,
      triggeredAt: event.triggered_at.toISOString(),
    };
  }

  async listForManager(managerAccountId: string, limit = 50) {
    const events = await this.prisma.sos_events.findMany({
      where: { manager_account_id: managerAccountId },
      orderBy: { triggered_at: 'desc' },
      take: limit,
      include: {
        device: { select: { id: true, owner_name: true } },
      },
    });
    return events.map((e) => ({
      id: e.id,
      deviceId: e.device_id,
      ownerName: e.device.owner_name,
      lat: Number(e.lat),
      lon: Number(e.lon),
      accuracy: e.accuracy_m,
      batteryLevel: e.battery_level,
      triggeredAt: e.triggered_at,
      acknowledgedAt: e.acknowledged_at,
    }));
  }

  async acknowledge(
    eventId: string,
    managerAccountId: string,
  ): Promise<void> {
    const event = await this.prisma.sos_events.findUnique({
      where: { id: eventId },
      select: { manager_account_id: true },
    });
    if (!event) throw new NotFoundException('SOS event not found');
    if (event.manager_account_id !== managerAccountId) {
      throw new ForbiddenException('Không có quyền với SOS event này');
    }
    await this.prisma.sos_events.update({
      where: { id: eventId },
      data: { acknowledged_at: new Date() },
    });
  }

  /**
   * Đánh dấu tất cả SOS chưa xử lý của manager này là đã xử lý — dùng cho nút
   * "Xử lý tất cả" trên trang lịch sử SOS. Scope cứng theo manager_account_id
   * trong filter để không leak event của manager khác.
   */
  async acknowledgeAll(managerAccountId: string): Promise<{ count: number }> {
    const result = await this.prisma.sos_events.updateMany({
      where: {
        manager_account_id: managerAccountId,
        acknowledged_at: null,
      },
      data: { acknowledged_at: new Date() },
    });
    return { count: result.count };
  }

  /**
   * Xoá vĩnh viễn các SOS event đã xử lý của manager này — nút "Xoá lịch sử".
   * KHÔNG xoá event chưa xử lý (vẫn cần hiển thị làm cảnh báo active).
   */
  async deleteAcknowledged(managerAccountId: string): Promise<{ count: number }> {
    const result = await this.prisma.sos_events.deleteMany({
      where: {
        manager_account_id: managerAccountId,
        acknowledged_at: { not: null },
      },
    });
    return { count: result.count };
  }
}
