import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { PushModule } from '../push/push.module';
import { SosController } from './sos.controller';
import { SosService } from './sos.service';

@Module({
  imports: [AuthModule, EventsModule, PushModule],
  controllers: [SosController],
  providers: [SosService],
  exports: [SosService],
})
export class SosModule {}
