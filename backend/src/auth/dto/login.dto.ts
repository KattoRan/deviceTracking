import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'parent@example.com' })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @ApiProperty({ example: 'matkhau123' })
  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  password: string;

  @ApiProperty({ example: 'Gia đình họ Nguyễn', required: false })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ example: '0987654321', required: false })
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'parent@example.com' })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @ApiProperty({ example: 'matkhau123' })
  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;
}

export class ManagerAccountDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'parent@example.com' })
  email: string;

  @ApiProperty({ example: 'Gia đình họ Nguyễn', nullable: true })
  displayName: string | null;

  @ApiProperty({ example: '0987654321', nullable: true })
  phoneNumber: string | null;

  @ApiProperty({ example: 'K7M-9X2' })
  pairingCode: string;
}

export class LoginResponseDto {
  @ApiProperty()
  token: string;

  @ApiProperty({ type: ManagerAccountDto })
  managerAccount: ManagerAccountDto;
}

export class UpdateProfileDto {
  @ApiProperty({ example: '0987654321', nullable: true, required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string | null;
}
