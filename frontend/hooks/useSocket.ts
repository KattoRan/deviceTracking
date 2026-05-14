"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { API_BASE_URL } from "@/lib/api";
import type { DeviceMovedEvent } from "@/types/device";

type DeviceMovedHandler = (event: DeviceMovedEvent) => void;

/**
 * Connects to the backend Socket.IO gateway and invokes `onDeviceMoved` for
 * every `device_moved` event. The socket is kept alive for the component's
 * lifetime and the callback is accessed via ref so consumers can pass an
 * inline handler without forcing reconnects on every render.
 */
export function useSocket(onDeviceMoved: DeviceMovedHandler) {
  const socketRef = useRef<Socket | null>(null);
  const handlerRef = useRef(onDeviceMoved);

  useEffect(() => {
    handlerRef.current = onDeviceMoved;
  }, [onDeviceMoved]);

  useEffect(() => {
    const socket = io(API_BASE_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });

    socket.on("device_moved", (event: DeviceMovedEvent) => {
      handlerRef.current(event);
    });

    socketRef.current = socket;

    return () => {
      socket.off("device_moved");
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return socketRef;
}
