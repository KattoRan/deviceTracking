import { io, type Socket } from 'socket.io-client';
import { SOCKET_CONFIG } from '../config/api';
import type { DeviceMovedEvent } from '../models/types';

type DeviceMovedCallback = (event: DeviceMovedEvent) => void;

let socket: Socket | null = null;
const listeners = new Set<DeviceMovedCallback>();

/**
 * Lazily connects to the backend Socket.IO gateway and registers a
 * fan-out dispatcher for `device_moved`. Calling this while a socket
 * already exists is a no-op.
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

  socket.on('device_moved', (event: DeviceMovedEvent) => {
    for (const cb of listeners) {
      try {
        cb(event);
      } catch {
        // listeners must never throw up the stack
      }
    }
  });

  return socket;
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}

/**
 * Subscribes to `device_moved` events. Returns an unsubscribe function.
 * Connects on first subscriber.
 */
export function onDeviceMoved(cb: DeviceMovedCallback): () => void {
  if (!socket) connectSocket();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
