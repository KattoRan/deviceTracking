import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { GeofencesModule } from '../geofences/geofences.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [AuthModule, EventsModule, GeofencesModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
