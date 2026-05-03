import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignDeviceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  deviceId: string;
}
