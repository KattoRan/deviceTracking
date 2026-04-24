import { Module, forwardRef } from '@nestjs/common';
import { CommandsModule } from '../commands/commands.module';
import { EventsGateway } from './events.gateway';

@Module({
  imports: [forwardRef(() => CommandsModule)],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
