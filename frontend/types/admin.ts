export interface Admin {
  id: string;
  username: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  admin: Admin;
}
