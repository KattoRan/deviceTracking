import { Module } from '@nestjs/common';
import { BtsController } from './bts.controller';
import { BtsService } from './bts.service';

@Module({
  controllers: [BtsController],
  providers: [BtsService],
  exports: [BtsService],
})
export class BtsModule {}
