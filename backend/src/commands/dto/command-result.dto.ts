import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CommandResultDto {
  @ApiProperty({ description: 'Command đã thực thi thành công hay chưa' })
  @IsBoolean()
  success!: boolean;

  @ApiPropertyOptional({ description: 'Mô tả lỗi nếu success=false' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}
