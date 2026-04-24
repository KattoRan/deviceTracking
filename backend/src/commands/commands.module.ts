import { Module, forwardRef } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { CommandsController } from './commands.controller';
import { CommandsService } from './commands.service';

@Module({
  imports: [forwardRef(() => EventsModule)],
  controllers: [CommandsController],
  providers: [CommandsService],
  exports: [CommandsService],
})
export class CommandsModule {}
