"use client";

import { useEffect, useRef } from "react";
import { useGeofenceAlerts } from "@/components/GeofenceAlerts";
import type { DeviceMovedEvent } from "@/types/device";

type DeviceMovedHandler = (event: DeviceMovedEvent) => void;

/**
 * Đăng ký `device_moved` qua socket dùng chung của <GeofenceAlertsProvider>.
 * Trước đây hook tự mở socket riêng — đã hợp nhất để toàn bộ web chỉ có một
 * kết nối Socket.IO, tránh nhân đôi traffic và race khi nhiều listener cùng
 * cập nhật state.
 *
 * Handler được giữ qua ref nên caller có thể truyền inline mà không gây
 * subscribe/unsubscribe theo mỗi render.
 */
export function useSocket(onDeviceMoved: DeviceMovedHandler) {
  const { subscribeDeviceMoved } = useGeofenceAlerts();
  const handlerRef = useRef(onDeviceMoved);

  useEffect(() => {
    handlerRef.current = onDeviceMoved;
  }, [onDeviceMoved]);

  useEffect(() => {
    return subscribeDeviceMoved((event) => handlerRef.current(event));
  }, [subscribeDeviceMoved]);
}
