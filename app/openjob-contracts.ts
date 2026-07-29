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

export type Member = {
  userId: string;
  username: string | null;
  role: "member" | "admin";
  joinedAt: string;
};

export type Ban = {
  userId: string;
  username: string | null;
  bannedAt: string;
};

export type InviteLink = {
  token: string;
  url: string;
  issuedAt: string;
  expiresAt: string;
  remainingJoins: number;
};

export type InvitePreview = { groupName: string };

export type TaskPriority = "high" | "normal" | "low";

export type Task = {
  taskId: string;
  groupId: string;
  text: string;
  assignee:
    | { state: "assigned"; userId: string; username: string }
    | { state: "unassigned" }
    | { state: "deleted" };
  priority: TaskPriority;
  dueDate: string | null;
  state: "open" | "done";
  createdAt: string;
  completedAt: string | null;
};

export type NotificationSubscriptionState = {
  installationId: string;
  state: "active" | "paused";
};

export type BrowserPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type SignInMethod = "apple" | "google";

export type GoogleAccountDeletionRevocationProof = {
  idToken: string;
  kind: "access_token";
  value: string;
};

export type AppleAccountDeletionRevocationProof =
  | { clientId: string; kind: "access_token"; value: string }
  | {
      clientId: string;
      idToken: string;
      kind: "authorization_code";
      redirectUri?: string;
      value: string;
    };

export type AccountDeletionPending = {
  deadline: string;
  reauthenticationProviders: SignInMethod[];
  requestedAt: string;
  status: "pending";
};

export type AccountDeletionPrepared = {
  status: "not_started";
  statusToken: string;
  submissionExpiresAt: string;
};

export type AccountDeletionStatusReceipt = {
  phase: "completed" | "prepared" | "submitting";
  statusToken: string;
  submissionExpiresAt: string | null;
  version: 1;
};

export type AccountDeletionPreflight =
  | AccountDeletionPrepared
  | { completedAt: string; status: "completed" }
  | (AccountDeletionPending & { statusToken: string });

export type AccountDeletionRequestResult =
  | { completedAt: string; status: "completed" }
  | (AccountDeletionPending & { statusToken: string });

export type AccountDeletionStatus =
  | { status: "completed" }
  | {
      status: "not_started";
      submissionExpired: boolean;
      submissionExpiresAt: string;
    }
  | AccountDeletionPending;

export type AuthenticationMethod = SignInMethod | "qa-password";

export type AuthSession = {
  signInMethod: AuthenticationMethod;
  getIdToken(): Promise<string>;
};

type AuthCredentialProofBase = {
  getIdToken(): Promise<string>;
  dispose(): Promise<void>;
};

export type AuthCredentialProof =
  | (AuthCredentialProofBase & {
      signInMethod: "google";
      getRevocationProof(): Promise<GoogleAccountDeletionRevocationProof>;
    })
  | (AuthCredentialProofBase & {
      signInMethod: "apple";
      getRevocationProof(): Promise<
        Extract<AppleAccountDeletionRevocationProof, { kind: "access_token" }>
      >;
    });

export type AccountDeletionCredentialInput =
  | {
      credentialToken: string;
      provider: "google";
      revocation: GoogleAccountDeletionRevocationProof;
    }
  | {
      credentialToken: string;
      provider: "apple";
      revocation: AppleAccountDeletionRevocationProof;
    };

export type OpenJobAuth = {
  readonly qaPasswordEnabled: boolean;
  observe(
    listener: (session: AuthSession | null) => void,
    onError?: (error: unknown) => void,
  ): () => void;
  signIn(method: SignInMethod): Promise<AuthCredentialProof | null>;
  signInWithQaPassword(email: string, password: string): Promise<void>;
  authenticateForLink(method: SignInMethod): Promise<AuthCredentialProof>;
  signOut(): Promise<void>;
  switchUser(): Promise<void>;
};

export type OpenJobApi = {
  getMe(token: string): Promise<User>;
  createUser(token: string): Promise<User>;
  listSignInMethods(token: string): Promise<SignInMethod[]>;
  linkSignInMethod(
    token: string,
    credentialToken: string,
    expectedTargetUserId: string,
  ): Promise<User>;
  claimUsername(token: string, username: string): Promise<User>;
  listGroups(token: string): Promise<Group[]>;
  getGroup(token: string, groupId: string): Promise<Group>;
  createGroup(token: string, name: string): Promise<Group>;
  renameGroup(token: string, groupId: string, name: string): Promise<Group>;
  leaveGroup(token: string, groupId: string): Promise<void>;
  endGroup(token: string, groupId: string, confirmationName: string): Promise<void>;
  inspectInvite(token: string, inviteToken: string): Promise<InvitePreview>;
  joinInvite(token: string, inviteToken: string): Promise<Group>;
  listMembers(token: string, groupId: string): Promise<Member[]>;
  promoteMember(token: string, groupId: string, userId: string): Promise<Member>;
  demoteMember(token: string, groupId: string, userId: string): Promise<Member>;
  kickMember(token: string, groupId: string, userId: string): Promise<void>;
  listBans(token: string, groupId: string): Promise<Ban[]>;
  banMember(token: string, groupId: string, userId: string): Promise<Ban>;
  unbanMember(token: string, groupId: string, userId: string): Promise<void>;
  getInviteLink(token: string, groupId: string): Promise<InviteLink>;
  rotateInviteLink(token: string, groupId: string): Promise<InviteLink>;
  listTasks(
    token: string,
    groupId: string,
    filters: { status: "open" | "done" | "all"; assignee?: string },
  ): Promise<Task[]>;
  createTask(
    token: string,
    groupId: string,
    input: {
      text: string;
      assigneeUsername: string;
      priority?: TaskPriority;
      dueDate?: string;
    },
  ): Promise<Task>;
  updateTask(
    token: string,
    groupId: string,
    taskId: string,
    input: {
      text?: string;
      assigneeUsername?: string;
      priority?: TaskPriority;
      dueDate?: string | null;
    },
  ): Promise<Task>;
  setTaskState(
    token: string,
    groupId: string,
    taskId: string,
    state: "open" | "done",
  ): Promise<Task>;
  deleteTask(token: string, groupId: string, taskId: string): Promise<void>;
  deleteUser(
    token: string,
    statusToken: string,
    credentials: AccountDeletionCredentialInput[],
  ): Promise<AccountDeletionRequestResult>;
  prepareAccountDeletion(
    token: string,
    credential?: AccountDeletionCredentialInput,
  ): Promise<AccountDeletionPreflight>;
  getAccountDeletionStatus(statusToken: string): Promise<AccountDeletionStatus>;
  refreshAccountDeletionProvider(
    statusToken: string,
    credential: AccountDeletionCredentialInput,
  ): Promise<AccountDeletionRequestResult>;
  getNotificationSubscription(
    token: string,
    installationId: string,
  ): Promise<NotificationSubscriptionState>;
  registerNotificationSubscription(
    token: string,
    installationId: string,
    subscription: BrowserPushSubscription,
  ): Promise<NotificationSubscriptionState>;
  setNotificationSubscriptionState(
    token: string,
    installationId: string,
    state: "active" | "paused",
  ): Promise<NotificationSubscriptionState>;
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
