import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { GeofenceStateService } from './geofence-state.service';
import { GeofencesController } from './geofences.controller';
import { GeofencesService } from './geofences.service';

@Module({
  imports: [AuthModule, EventsModule],
  controllers: [GeofencesController],
  providers: [GeofencesService, GeofenceStateService],
  exports: [GeofenceStateService],
})
export class GeofencesModule {}
