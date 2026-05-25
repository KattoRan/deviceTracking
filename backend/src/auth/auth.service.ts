import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import {
  LoginDto,
  LoginResponseDto,
  ParentAccountDto,
  RegisterDto,
} from './dto/login.dto';
import { generatePairingCode } from './pairing-code.util';

const BCRYPT_ROUNDS = 10;
const MAX_PAIRING_CODE_ATTEMPTS = 5;

export interface JwtPayload {
  sub: string; // parentAccountId
  email: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<LoginResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.parent_accounts.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException('Email đã được đăng ký');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const pairingCode = await this.allocatePairingCode();

    const account = await this.prisma.parent_accounts.create({
      data: {
        email,
        password_hash: passwordHash,
        display_name: dto.displayName?.trim() || null,
        phone_number: dto.phoneNumber?.trim() || null,
        pairing_code: pairingCode,
      },
    });
    this.logger.log(`Đăng ký phụ huynh ${email} với pairing code ${pairingCode}`);

    return this.buildSession(account);
  }

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const account = await this.prisma.parent_accounts.findUnique({
      where: { email },
    });
    if (!account) throw new UnauthorizedException('Sai email hoặc mật khẩu');

    const ok = await bcrypt.compare(dto.password, account.password_hash);
    if (!ok) throw new UnauthorizedException('Sai email hoặc mật khẩu');

    return this.buildSession(account);
  }

  async findById(id: string): Promise<ParentAccountDto> {
    const account = await this.prisma.parent_accounts.findUnique({
      where: { id },
    });
    if (!account) throw new UnauthorizedException('Tài khoản không tồn tại');
    return {
      id: account.id,
      email: account.email,
      displayName: account.display_name,
      phoneNumber: account.phone_number,
      pairingCode: account.pairing_code,
    };
  }

  private async buildSession(account: {
    id: string;
    email: string;
    display_name: string | null;
    phone_number: string | null;
    pairing_code: string;
  }): Promise<LoginResponseDto> {
    const payload: JwtPayload = { sub: account.id, email: account.email };
    const token = await this.jwt.signAsync(payload);
    return {
      token,
      parentAccount: {
        id: account.id,
        email: account.email,
        displayName: account.display_name,
        phoneNumber: account.phone_number,
        pairingCode: account.pairing_code,
      },
    };
  }

  private async allocatePairingCode(): Promise<string> {
    for (let attempt = 0; attempt < MAX_PAIRING_CODE_ATTEMPTS; attempt++) {
      const code = generatePairingCode();
      const taken = await this.prisma.parent_accounts.findUnique({
        where: { pairing_code: code },
        select: { id: true },
      });
      if (!taken) return code;
    }
    throw new Error('Không thể sinh pairing code (collision liên tục)');
  }
}
