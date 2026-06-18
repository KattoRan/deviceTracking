import { apiClient } from "@/lib/api";
import type {
  CommandListResponse,
  CommandName,
  CommandPayload,
  CommandStatus,
  CreateCommandResponse,
} from "@/types/command";

interface ListCommandsParams {
  status?: CommandStatus;
  limit?: number;
  offset?: number;
}

export const commandService = {
  create: async (
    deviceId: string,
    command: CommandName,
    payload?: CommandPayload,
  ): Promise<CreateCommandResponse> => {
    const { data } = await apiClient.post<CreateCommandResponse>(
      `api/v1/devices/${deviceId}/commands`,
      { command, payload },
    );
    return data;
  },

  list: async (
    deviceId: string,
    params: ListCommandsParams = {},
  ): Promise<CommandListResponse> => {
    const { data } = await apiClient.get<CommandListResponse>(
      `api/v1/devices/${deviceId}/commands`,
      { params },
    );
    return data;
  },
};

export default commandService;
