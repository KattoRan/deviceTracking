export type CommandName =
  | "request_location_now"
  | "ring_alarm"
  | "lock_device";

export type CommandStatus = "pending" | "delivered" | "executed" | "failed";

export interface RingAlarmPayload {
  durationSec?: number;
  volume?: number;
}

export interface LockDevicePayload {
  message?: string;
}

export type CommandPayload =
  | Record<string, never>
  | RingAlarmPayload
  | LockDevicePayload;

export interface CreateCommandResponse {
  commandId: string;
  status: CommandStatus;
  createdAt: string;
}

export interface CommandRow {
  id: string;
  command: CommandName;
  payload: CommandPayload | null;
  status: CommandStatus;
  createdAt: string;
  deliveredAt: string | null;
  executedAt: string | null;
  error: string | null;
}

export interface CommandListResponse {
  total: number;
  items: CommandRow[];
}

export interface CommandStatusChangedEvent {
  deviceId: string;
  commandId: string;
  status: Exclude<CommandStatus, "pending">;
  error?: string | null;
}

