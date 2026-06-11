"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { API_BASE_URL } from "@/lib/api";
import type { CommandStatusChangedEvent } from "@/types/command";

interface Handlers {
  onCommandStatusChanged?: (e: CommandStatusChangedEvent) => void;
}

/**
 * Subscribes to command/status + global-setting broadcasts.
 *
 * Separate from `useSocket` (which handles `device_moved`) so callers that
 * only care about commands don't pay the cost of re-running on device-moved
 * events — and so a tracking page can mount both hooks without conflict.
 */
export function useCommandSocket(handlers: Handlers) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const socket: Socket = io(API_BASE_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });

    socket.on("command_status_changed", (event: CommandStatusChangedEvent) => {
      handlersRef.current.onCommandStatusChanged?.(event);
    });

    return () => {
      socket.off("command_status_changed");
      socket.disconnect();
    };
  }, []);
}
