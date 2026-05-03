import { Inject, Logger, forwardRef } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { CommandsService } from '../commands/commands.service';

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

export interface CommandDispatchEvent {
  commandId: string;
  command: string;
  payload: Record<string, unknown>;
}

export interface CommandStatusChangedEvent {
  deviceId: string;
  commandId: string;
  status: 'delivered' | 'executed' | 'failed';
  error?: string | null;
}

export interface TrackingIntervalChangedEvent {
  intervalSec: number;
  updatedAt: string;
}

export interface GeofenceBreachEvent {
  deviceId: string;
  deviceName: string | null;
  geofenceId: string;
  geofenceName: string;
  status: 'outside' | 'returned';
  lat: number;
  lon: number;
  centerLat: number;
  centerLon: number;
  radiusM: number;
  distanceM: number;
  timestamp: string;
}

/** Room name a device joins to receive its own commands. */
function deviceRoom(deviceId: string): string {
  return `device:${deviceId}`;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(forwardRef(() => CommandsService))
    private readonly commandsService: CommandsService,
  ) {}

  afterInit() {
    this.logger.log('Socket.IO gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /**
   * Mobile clients call this right after connect to subscribe to commands
   * targeted at them. Frontends don't need to join — they just listen for
   * broadcast `command_status_changed` and `tracking_interval_changed`.
   */
  @SubscribeMessage('join_device')
  handleJoinDevice(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { deviceId?: string } | string,
  ): { ok: boolean } {
    const deviceId =
      typeof body === 'string' ? body : body?.deviceId?.trim() || '';
    if (!deviceId) return { ok: false };
    void client.join(deviceRoom(deviceId));
    this.logger.debug(`Socket ${client.id} joined ${deviceRoom(deviceId)}`);
    return { ok: true };
  }

  @SubscribeMessage('command_ack')
  async handleCommandAck(
    @MessageBody() body: { commandId?: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.commandId) return { ok: false };
    await this.commandsService.handleAck(body.commandId);
    return { ok: true };
  }

  @SubscribeMessage('command_result')
  async handleCommandResult(
    @MessageBody()
    body: {
      commandId?: string;
      success?: boolean;
      error?: string | null;
    },
  ): Promise<{ ok: boolean }> {
    if (!body?.commandId) return { ok: false };
    await this.commandsService.handleResult({
      commandId: body.commandId,
      success: !!body.success,
      error: body.error ?? null,
    });
    return { ok: true };
  }

  emitDeviceMoved(event: DeviceMovedEvent) {
    this.server.emit('device_moved', event);
  }

  /** Targets only the owning device's socket(s). */
  emitCommand(deviceId: string, event: CommandDispatchEvent) {
    this.server.to(deviceRoom(deviceId)).emit('command', event);
  }

  /** Broadcast so every frontend observing this device can update its UI. */
  emitCommandStatusChanged(event: CommandStatusChangedEvent) {
    this.server.emit('command_status_changed', event);
  }

  /**
   * Global fan-out — every connected device and every frontend receives it.
   * Per product requirement the tracking interval is a single shared value.
   */
  emitTrackingIntervalChanged(event: TrackingIntervalChangedEvent) {
    this.server.emit('tracking_interval_changed', event);
  }

  /**
   * Single global emit — every dashboard sees every alert; mobile clients
   * filter by their own deviceId. Sending to the device room in addition
   * to a global emit would double-deliver to the offending phone, so we
   * deliberately emit once.
   */
  emitGeofenceBreach(event: GeofenceBreachEvent) {
    this.server.emit('geofence_breach', event);
  }
}
