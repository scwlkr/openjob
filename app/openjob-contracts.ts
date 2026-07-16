export type User = {
  userId: string;
  username: string | null;
  usernameRequired: boolean;
};

export type Group = {
  groupId: string;
  name: string;
  role: "member" | "admin";
  createdAt: string;
};

export type AuthSession = { getIdToken(): Promise<string> };

export type OpenJobAuth = {
  observe(
    listener: (session: AuthSession | null) => void,
    onError?: (error: unknown) => void,
  ): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
};

export type OpenJobApi = {
  getMe(token: string): Promise<User>;
  claimUsername(token: string, username: string): Promise<User>;
  listGroups(token: string): Promise<Group[]>;
  getGroup(token: string, groupId: string): Promise<Group>;
  createGroup(token: string, name: string): Promise<Group>;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
