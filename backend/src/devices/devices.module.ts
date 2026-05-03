import { Module } from '@nestjs/common';
import { GeofencesModule } from '../geofences/geofences.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [GeofencesModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
