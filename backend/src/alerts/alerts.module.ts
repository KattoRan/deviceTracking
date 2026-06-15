import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventsModule } from '../events/events.module';
import { AlertsService } from './alerts.service';

@Module({
  imports: [ScheduleModule.forRoot(), EventsModule],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
