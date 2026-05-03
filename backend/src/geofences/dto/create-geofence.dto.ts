import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateGeofenceDto {
  @ApiProperty({ example: 'Trụ sở chính' })
  @IsString()
  @IsNotEmpty({ message: 'Tên không được để trống' })
  name: string;

  @ApiProperty({ example: 21.028511 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 105.804817 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon: number;

  @ApiProperty({ example: 200, minimum: 10, maximum: 100_000 })
  @IsInt()
  @Min(10, { message: 'Bán kính tối thiểu 10m' })
  @Max(100_000, { message: 'Bán kính tối đa 100km' })
  radiusM: number;
}
