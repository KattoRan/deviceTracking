import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class DeviceInfoDto {
  @ApiPropertyOptional({ example: 'Pixel 7' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ example: 'smartphone' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: 'Android 14' })
  @IsOptional()
  @IsString()
  os?: string;
}

export class RegisterDeviceDto {
  @ApiProperty({ example: 'Nguyen Van A', minLength: 2 })
  @IsString()
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @MinLength(2, { message: 'Họ tên phải có ít nhất 2 ký tự' })
  fullName: string;

  @ApiProperty({ example: 'a@example.com' })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @ApiPropertyOptional({ example: 'Hà Nội' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ example: '012345678901', pattern: '^[0-9]{9,12}$' })
  @Matches(/^[0-9]{9,12}$/, { message: 'Số CCCD phải có 9-12 chữ số' })
  citizenId: string;

  @ApiProperty({ example: '0987654321', pattern: '^(0|\\+84)[0-9]{9}$' })
  @Matches(/^(0|\+84)[0-9]{9}$/, {
    message: 'Số điện thoại không hợp lệ (bắt đầu bằng 0 hoặc +84)',
  })
  phoneNumber: string;

  @ApiProperty({ type: DeviceInfoDto })
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  @IsNotEmpty()
  device: DeviceInfoDto;
}

export class RegisterDeviceResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ format: 'uuid' })
  deviceId: string;
}
