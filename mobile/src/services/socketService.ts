import { io, type Socket } from 'socket.io-client';
import { SOCKET_CONFIG } from '../config/api';
import type {
  CommandDispatchEvent,
  CommandResultBody,
  DeviceMovedEvent,
  GeofenceBreachEvent,
  TrackingIntervalChangedEvent,
} from '../models/types';

type DeviceMovedCallback = (event: DeviceMovedEvent) => void;
type CommandCallback = (event: CommandDispatchEvent) => void;
type TrackingIntervalCallback = (event: TrackingIntervalChangedEvent) => void;
type GeofenceBreachCallback = (event: GeofenceBreachEvent) => void;

let socket: Socket | null = null;
let joinedDeviceId: string | null = null;
const deviceMovedListeners = new Set<DeviceMovedCallback>();
const commandListeners = new Set<CommandCallback>();
const trackingIntervalListeners = new Set<TrackingIntervalCallback>();
const geofenceBreachListeners = new Set<GeofenceBreachCallback>();

function fanOut<T>(listeners: Set<(event: T) => void>, event: T): void {
  for (const cb of listeners) {
    try {
      cb(event);
    } catch {
      // listeners must never throw up the stack
    }
  }
}

/**
 * Lazily connects to the backend Socket.IO gateway and registers dispatchers
 * for device_moved, command, and tracking_interval_changed. Calling this
 * while a socket already exists is a no-op.
 */
export function connectSocket(): Socket {
  if (socket?.connected) return socket;
  if (socket) socket.disconnect();

  socket = io(SOCKET_CONFIG.url, {
    transports: [...SOCKET_CONFIG.options.transports],
    reconnection: SOCKET_CONFIG.options.reconnection,
    reconnectionAttempts: SOCKET_CONFIG.options.reconnectionAttempts,
    reconnectionDelay: SOCKET_CONFIG.options.reconnectionDelay,
    reconnectionDelayMax: SOCKET_CONFIG.options.reconnectionDelayMax,
  });

  socket.on('device_moved', (event: DeviceMovedEvent) =>
    fanOut(deviceMovedListeners, event),
  );
  socket.on('command', (event: CommandDispatchEvent) =>
    fanOut(commandListeners, event),
  );
  socket.on(
    'tracking_interval_changed',
    (event: TrackingIntervalChangedEvent) =>
      fanOut(trackingIntervalListeners, event),
  );
  socket.on('geofence_breach', (event: GeofenceBreachEvent) =>
    fanOut(geofenceBreachListeners, event),
  );

  // Re-join the device room on every connect/reconnect — socket.io rooms are
  // per-socket and are lost on disconnect.
  socket.on('connect', () => {
    if (joinedDeviceId) {
      socket?.emit('join_device', { deviceId: joinedDeviceId });
    }
  });

  return socket;
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.disconnect();
  socket = null;
  joinedDeviceId = null;
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}

/**
 * Subscribes this socket to commands targeted at `deviceId`. Safe to call
 * before the socket connects — the id is re-sent on every reconnect.
 */
export function joinDeviceRoom(deviceId: string): void {
  joinedDeviceId = deviceId;
  if (!socket) connectSocket();
  if (socket?.connected) {
    socket.emit('join_device', { deviceId });
  }
}

export function onDeviceMoved(cb: DeviceMovedCallback): () => void {
  if (!socket) connectSocket();
  deviceMovedListeners.add(cb);
  return () => {
    deviceMovedListeners.delete(cb);
  };
}

export function onCommand(cb: CommandCallback): () => void {
  if (!socket) connectSocket();
  commandListeners.add(cb);
  return () => {
    commandListeners.delete(cb);
  };
}

export function onTrackingIntervalChanged(
  cb: TrackingIntervalCallback,
): () => void {
  if (!socket) connectSocket();
  trackingIntervalListeners.add(cb);
  return () => {
    trackingIntervalListeners.delete(cb);
  };
}

export function onGeofenceBreach(cb: GeofenceBreachCallback): () => void {
  if (!socket) connectSocket();
  geofenceBreachListeners.add(cb);
  return () => {
    geofenceBreachListeners.delete(cb);
  };
}

export function ackCommand(commandId: string): void {
  if (!socket?.connected) return;
  socket.emit('command_ack', { commandId });
}

export function sendCommandResult(body: CommandResultBody): void {
  if (!socket?.connected) return;
  socket.emit('command_result', body);
}
