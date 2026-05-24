import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { BtsModule } from '../bts/bts.module';
import { EventsModule } from '../events/events.module';
import { GeofencesModule } from '../geofences/geofences.module';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

@Module({
  imports: [EventsModule, BtsModule, GeofencesModule, AlertsModule],
  controllers: [IngestController],
  providers: [IngestService],
  exports: [IngestService],
})
export class IngestModule {}
