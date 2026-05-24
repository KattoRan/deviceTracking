export interface ParentAccount {
  id: string;
  email: string;
  displayName: string | null;
  pairingCode: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  parentAccount: ParentAccount;
}
