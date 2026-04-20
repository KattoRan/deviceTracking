import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

export interface DeviceMovedEvent {
  deviceId: string;
  lat: number;
  lon: number;
  cid: number | null;
  lac: number | null;
  signalDbm: number | null;
  timestamp: string;
  cellTowers: Array<{
    type: string;
    mcc: number;
    mnc: number;
    lac: number;
    cid: number;
    pci: number | null;
    rssi: number | null;
    signalDbm: number;
    isServing: boolean;
  }>;
  connectedBts: {
    id: number;
    lat: number;
    lon: number;
    radio: string | null;
    range: number | null;
  } | null;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Server;

  afterInit() {
    this.logger.log('Socket.IO gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  emitDeviceMoved(event: DeviceMovedEvent) {
    this.server.emit('device_moved', event);
  }
}
