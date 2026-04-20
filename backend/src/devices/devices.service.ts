import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterDeviceDto): Promise<{ userId: string; deviceId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const [emailExists, citizenExists, phoneExists] = await Promise.all([
        tx.users.findUnique({ where: { email: dto.email }, select: { id: true } }),
        tx.users.findUnique({ where: { citizen_id: dto.citizenId }, select: { id: true } }),
        tx.devices.findUnique({ where: { phone_number: dto.phoneNumber }, select: { id: true } }),
      ]);

      if (emailExists) throw new ConflictException('Email đã được đăng ký');
      if (citizenExists) throw new ConflictException('Số CCCD đã được đăng ký');
      if (phoneExists) throw new ConflictException('Số điện thoại đã được đăng ký');

      const user = await tx.users.create({
        data: {
          full_name: dto.fullName.trim(),
          email: dto.email.trim().toLowerCase(),
          address: dto.address?.trim() || null,
          citizen_id: dto.citizenId,
        },
        select: { id: true },
      });

      const device = await tx.devices.create({
        data: {
          user_id: user.id,
          phone_number: dto.phoneNumber,
          model: dto.device.model?.trim() || null,
          type: dto.device.type?.trim() || null,
          device_os: dto.device.os?.trim() || null,
        },
        select: { id: true },
      });

      this.logger.log(`Registered user=${user.id} device=${device.id}`);
      return { userId: user.id, deviceId: device.id };
    });
  }
}
