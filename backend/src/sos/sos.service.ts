import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
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
    private readonly push: PushService,
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
        parent_account_id: true,
        person_name: true,
      },
    });
    if (!device) throw new NotFoundException('Device not found');

    const event = await this.prisma.sos_events.create({
      data: {
        device_id: deviceId,
        parent_account_id: device.parent_account_id,
        lat: dto.lat,
        lon: dto.lon,
        accuracy_m: dto.accuracy ?? null,
        battery_level: dto.batteryLevel ?? null,
      },
    });

    this.logger.warn(
      `🆘 SOS device=${deviceId} (${device.person_name}) ` +
        `pos=(${dto.lat},${dto.lon}) battery=${dto.batteryLevel ?? '?'}%`,
    );

    this.events.emitSosAlert({
      sosEventId: event.id,
      deviceId,
      deviceName: device.person_name,
      lat: dto.lat,
      lon: dto.lon,
      accuracy: dto.accuracy ?? null,
      batteryLevel: dto.batteryLevel ?? null,
      triggeredAt: event.triggered_at.toISOString(),
    });

    // Fire-and-forget — không chặn response để mobile nhận ACK nhanh.
    void this.push.send(device.parent_account_id, {
      type: 'sos',
      title: '🆘 SOS từ ' + device.person_name,
      body: 'Người được giám sát vừa bấm SOS. Bấm để xem vị trí.',
      url: `/tracking?focus=${deviceId}&sos=${event.id}`,
      data: {
        deviceId,
        sosEventId: event.id,
        lat: dto.lat,
        lon: dto.lon,
      },
    });

    return {
      sosEventId: event.id,
      triggeredAt: event.triggered_at.toISOString(),
    };
  }

  async listForParent(parentAccountId: string, limit = 50) {
    const events = await this.prisma.sos_events.findMany({
      where: { parent_account_id: parentAccountId },
      orderBy: { triggered_at: 'desc' },
      take: limit,
      include: {
        device: { select: { id: true, person_name: true, person_type: true } },
      },
    });
    return events.map((e) => ({
      id: e.id,
      deviceId: e.device_id,
      personName: e.device.person_name,
      personType: e.device.person_type,
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
    parentAccountId: string,
  ): Promise<void> {
    const event = await this.prisma.sos_events.findUnique({
      where: { id: eventId },
      select: { parent_account_id: true },
    });
    if (!event) throw new NotFoundException('SOS event not found');
    if (event.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với SOS event này');
    }
    await this.prisma.sos_events.update({
      where: { id: eventId },
      data: { acknowledged_at: new Date() },
    });
  }
}
