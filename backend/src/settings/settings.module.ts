import { Module, forwardRef } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [forwardRef(() => EventsModule)],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
