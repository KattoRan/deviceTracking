"use client";

import { useEffect, useRef } from "react";
import { useGeofenceAlerts } from "@/components/GeofenceAlerts";
import type { DeviceHeartbeatEvent, DeviceMovedEvent } from "@/types/device";

type DeviceMovedHandler = (event: DeviceMovedEvent) => void;
type DeviceHeartbeatHandler = (event: DeviceHeartbeatEvent) => void;

/**
 * Đăng ký `device_moved` (và tuỳ chọn `device_heartbeat`) qua socket dùng
 * chung của <GeofenceAlertsProvider>. Trước đây hook tự mở socket riêng —
 * đã hợp nhất để toàn bộ web chỉ có một kết nối Socket.IO, tránh nhân đôi
 * traffic và race khi nhiều listener cùng cập nhật state.
 *
 * Handlers được giữ qua ref nên caller có thể truyền inline mà không gây
 * subscribe/unsubscribe theo mỗi render.
 */
export function useSocket(
  onDeviceMoved: DeviceMovedHandler,
  onDeviceHeartbeat?: DeviceHeartbeatHandler,
) {
  const { subscribeDeviceMoved, subscribeDeviceHeartbeat } =
    useGeofenceAlerts();
  const movedRef = useRef(onDeviceMoved);
  const heartbeatRef = useRef(onDeviceHeartbeat);

  useEffect(() => {
    movedRef.current = onDeviceMoved;
  }, [onDeviceMoved]);

  useEffect(() => {
    heartbeatRef.current = onDeviceHeartbeat;
  }, [onDeviceHeartbeat]);

  useEffect(() => {
    return subscribeDeviceMoved((event) => movedRef.current(event));
  }, [subscribeDeviceMoved]);

  useEffect(() => {
    return subscribeDeviceHeartbeat((event) => {
      heartbeatRef.current?.(event);
    });
  }, [subscribeDeviceHeartbeat]);
}
