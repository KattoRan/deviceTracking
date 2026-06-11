import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

export class PairDeviceDto {
  @ApiProperty({ example: 'K7M-9X2', description: 'Pairing code người quản lý cung cấp' })
  @IsString()
  @IsNotEmpty({ message: 'Pairing code không được để trống' })
  pairingCode: string;

  @ApiProperty({ example: 'Nguyễn Văn A', minLength: 1 })
  @IsString()
  @IsNotEmpty({ message: 'Tên người được giám sát không được để trống' })
  @MinLength(1)
  personName: string;

  @ApiPropertyOptional({ example: '0987654321' })
  @IsOptional()
  @Matches(/^(0|\+84)[0-9]{9}$/, {
    message: 'Số điện thoại không hợp lệ (bắt đầu bằng 0 hoặc +84)',
  })
  phoneNumber?: string;

  @ApiPropertyOptional({ type: DeviceInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device?: DeviceInfoDto;
}

export class PairDeviceResponseDto {
  @ApiProperty({ format: 'uuid' })
  deviceId: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  personName: string;
}
