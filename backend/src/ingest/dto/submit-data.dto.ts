import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class LocationDto {
  @ApiProperty({ example: 21.028511 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ example: 105.804817 })
  @IsNumber()
  longitude: number;
}

export class CellTowerDto {
  @ApiProperty({ example: 'LTE' })
  @IsString()
  type: string;

  @ApiProperty() @IsInt() mcc: number;
  @ApiProperty() @IsInt() mnc: number;
  @ApiProperty() @IsInt() lac: number;
  @ApiProperty() @IsInt() cid: number;

  @ApiProperty() @IsNumber() signalDbm: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() rssi?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() pci?: number;
}

export class SubmitDataDto {
  @ApiProperty({ type: LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  location: LocationDto;

  @ApiPropertyOptional({ type: [CellTowerDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CellTowerDto)
  cellTowers?: CellTowerDto[];
}
