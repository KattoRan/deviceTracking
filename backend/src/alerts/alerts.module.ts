import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventsModule } from '../events/events.module';
import { PushModule } from '../push/push.module';
import { AlertsService } from './alerts.service';

@Module({
  imports: [ScheduleModule.forRoot(), EventsModule, PushModule],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
