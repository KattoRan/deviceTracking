import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BtsModule } from './bts/bts.module';
import { CommandsModule } from './commands/commands.module';
import { DevicesModule } from './devices/devices.module';
import { EventsModule } from './events/events.module';
import { IngestModule } from './ingest/ingest.module';
import { MqttModule } from './mqtt/mqtt.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    EventsModule,
    BtsModule,
    IngestModule,
    MqttModule,
    DevicesModule,
    CommandsModule,
    SettingsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
