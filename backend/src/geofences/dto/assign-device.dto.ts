import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class AssignDeviceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  deviceId: string;
}

export class SetDevicesDto {
  @ApiProperty({
    description: 'Danh sách deviceId mới — service sẽ diff với gán cũ và cập nhật',
    type: [String],
    format: 'uuid',
  })
  @IsArray()
  @ArrayMinSize(0)
  @IsUUID('all', { each: true })
  deviceIds: string[];
}
