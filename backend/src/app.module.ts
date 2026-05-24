import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AlertsModule } from './alerts/alerts.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BtsModule } from './bts/bts.module';
import { CommandsModule } from './commands/commands.module';
import { DevicesModule } from './devices/devices.module';
import { EventsModule } from './events/events.module';
import { GeofencesModule } from './geofences/geofences.module';
import { IngestModule } from './ingest/ingest.module';
import { MqttModule } from './mqtt/mqtt.module';
import { PrismaModule } from './prisma/prisma.module';
import { PushModule } from './push/push.module';
import { RedisModule } from './redis/redis.module';
import { SettingsModule } from './settings/settings.module';
import { SosModule } from './sos/sos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    EventsModule,
    AuthModule,
    BtsModule,
    GeofencesModule,
    AlertsModule,
    IngestModule,
    MqttModule,
    DevicesModule,
    CommandsModule,
    SettingsModule,
    PushModule,
    SosModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
