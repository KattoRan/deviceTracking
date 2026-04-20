import { Module } from '@nestjs/common';
import { IngestModule } from '../ingest/ingest.module';
import { MqttService } from './mqtt.service';

@Module({
  imports: [IngestModule],
  providers: [MqttService],
})
export class MqttModule {}
