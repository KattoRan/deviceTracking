"use client";

import { useEffect, useRef } from "react";
import { useGeofenceAlerts } from "@/components/GeofenceAlerts";
import type { CommandStatusChangedEvent } from "@/types/command";

interface Handlers {
  onCommandStatusChanged?: (e: CommandStatusChangedEvent) => void;
}

/**
 * Đăng ký `command_status_changed` qua socket dùng chung của
 * <GeofenceAlertsProvider>. Trước đây hook tự mở 1 kết nối Socket.IO riêng —
 * đã hợp nhất để toàn web chỉ có một socket, tránh tốn kết nối + log nhiễu
 * mỗi lần RemoteControlPanel mount/unmount.
 *
 * Handler giữ qua ref nên caller truyền inline mà không gây subscribe lại
 * theo mỗi render.
 */
export function useCommandSocket(handlers: Handlers) {
  const { subscribeCommandStatusChanged } = useGeofenceAlerts();
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    return subscribeCommandStatusChanged((event) => {
      handlersRef.current.onCommandStatusChanged?.(event);
    });
  }, [subscribeCommandStatusChanged]);
}
