import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, LoginResponseDto } from './dto/login.dto';

const BCRYPT_ROUNDS = 10;
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin123';

export interface JwtPayload {
  sub: string;
  username: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit(): Promise<void> {
    const count = await this.prisma.admins.count();
    if (count > 0) return;
    const password_hash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);
    await this.prisma.admins.create({
      data: { username: DEFAULT_USERNAME, password_hash },
    });
    this.logger.warn(
      `Seeded default admin account: ${DEFAULT_USERNAME} / ${DEFAULT_PASSWORD} — đổi mật khẩu ngay sau khi đăng nhập`,
    );
  }

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const admin = await this.prisma.admins.findUnique({
      where: { username: dto.username.trim() },
    });
    if (!admin) throw new UnauthorizedException('Sai tên đăng nhập hoặc mật khẩu');

    const ok = await bcrypt.compare(dto.password, admin.password_hash);
    if (!ok) throw new UnauthorizedException('Sai tên đăng nhập hoặc mật khẩu');

    const payload: JwtPayload = { sub: admin.id, username: admin.username };
    const token = await this.jwt.signAsync(payload);
    return { token, admin: { id: admin.id, username: admin.username } };
  }

  async findById(id: string): Promise<{ id: string; username: string }> {
    const admin = await this.prisma.admins.findUnique({
      where: { id },
      select: { id: true, username: true },
    });
    if (!admin) throw new UnauthorizedException('Tài khoản không tồn tại');
    return admin;
  }
}
