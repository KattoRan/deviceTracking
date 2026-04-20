import { Module } from '@nestjs/common';
import { BtsModule } from '../bts/bts.module';
import { EventsModule } from '../events/events.module';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

@Module({
  imports: [EventsModule, BtsModule],
  controllers: [IngestController],
  providers: [IngestService],
  exports: [IngestService],
})
export class IngestModule {}
