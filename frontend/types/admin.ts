export interface ParentAccount {
  id: string;
  email: string;
  displayName: string | null;
  phoneNumber: string | null;
  pairingCode: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
  phoneNumber?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UpdateProfileInput {
  phoneNumber: string | null;
}

export interface LoginResponse {
  token: string;
  parentAccount: ParentAccount;
}
