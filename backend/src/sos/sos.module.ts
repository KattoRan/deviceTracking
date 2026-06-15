import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { SosController } from './sos.controller';
import { SosService } from './sos.service';

@Module({
  imports: [AuthModule, EventsModule],
  controllers: [SosController],
  providers: [SosService],
  exports: [SosService],
})
export class SosModule {}
