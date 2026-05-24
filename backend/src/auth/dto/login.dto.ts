import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

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

export class ParentAccountDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'parent@example.com' })
  email: string;

  @ApiProperty({ example: 'Gia đình họ Nguyễn', nullable: true })
  displayName: string | null;

  @ApiProperty({ example: 'K7M-9X2' })
  pairingCode: string;
}

export class LoginResponseDto {
  @ApiProperty()
  token: string;

  @ApiProperty({ type: ParentAccountDto })
  parentAccount: ParentAccountDto;
}
