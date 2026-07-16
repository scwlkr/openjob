import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  ApiError,
  OpenJobApp,
  type AuthSession,
  type Group,
  type OpenJobApi,
  type OpenJobAuth,
  type User,
} from "../../../app/openjob-app";
import "../../../app/globals.css";

const AUTH_KEY = "openjob-test:auth";
const STATE_KEY = "openjob-test:api-state";
const scenario = new URLSearchParams(window.location.search).get("scenario");

type FixtureState = {
  user: User;
  groups: Group[];
};

const fixtureSession: AuthSession = {
  async getIdToken() {
    return "browser-test-token";
  },
};

function seedState(): FixtureState {
  if (scenario === "multiple" || scenario === "concealed") {
    return {
      user: {
        userId: "user_shane",
        username: "shane",
        usernameRequired: false,
      },
      groups:
        scenario === "concealed"
          ? [
              {
                groupId: "grp_concealed",
                name: "Retired Operations",
                role: "member",
                createdAt: "2026-07-16T15:00:00.000Z",
              },
            ]
          : [
              {
                groupId: "grp_walker",
                name: "Walker Labs",
                role: "admin",
                createdAt: "2026-07-15T15:00:00.000Z",
              },
              {
                groupId: "grp_openjob",
                name: "OpenJob Core",
                role: "member",
                createdAt: "2026-07-16T15:00:00.000Z",
              },
            ],
    };
  }

  return {
    user: {
      userId: "user_shane",
      username: null,
      usernameRequired: true,
    },
    groups: [],
  };
}

function readState(): FixtureState {
  const stored = window.localStorage.getItem(STATE_KEY);
  return stored ? (JSON.parse(stored) as FixtureState) : seedState();
}

class FixtureAuth implements OpenJobAuth {
  private listeners = new Set<(session: AuthSession | null) => void>();
  private session =
    scenario === "multiple" || scenario === "concealed" || scenario === "loading" || scenario === "error"
      ? fixtureSession
      : window.localStorage.getItem(AUTH_KEY)
        ? fixtureSession
        : null;

  observe(listener: (session: AuthSession | null) => void) {
    this.listeners.add(listener);
    queueMicrotask(() => {
      if (this.listeners.has(listener)) listener(this.session);
    });
    return () => this.listeners.delete(listener);
  }

  async signIn() {
    window.localStorage.setItem(AUTH_KEY, "signed-in");
    this.session = fixtureSession;
    this.emit();
  }

  async signOut() {
    window.localStorage.removeItem(AUTH_KEY);
    this.session = null;
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener(this.session);
  }
}

class FixtureApi implements OpenJobApi {
  private state = readState();

  async getMe() {
    if (scenario === "loading") return await new Promise<never>(() => undefined);
    if (scenario === "error") {
      throw new ApiError(500, "internal_error", "An unexpected error occurred.");
    }
    return this.state.user;
  }

  async claimUsername(_token: string, username: string) {
    this.state.user = {
      ...this.state.user,
      username,
      usernameRequired: false,
    };
    this.persist();
    return this.state.user;
  }

  async listGroups() {
    return [...this.state.groups];
  }

  async getGroup(_token: string, groupId: string) {
    if (scenario === "concealed" && groupId === "grp_concealed") {
      throw new ApiError(404, "not_found", "The requested resource was not found.");
    }
    const group = this.state.groups.find((item) => item.groupId === groupId);
    if (!group) {
      throw new ApiError(404, "not_found", "The requested resource was not found.");
    }
    return group;
  }

  async createGroup(_token: string, name: string) {
    const group: Group = {
      groupId: `grp_${String(this.state.groups.length + 1).padStart(4, "0")}`,
      name: name.trim(),
      role: "admin",
      createdAt: "2026-07-16T16:00:00.000Z",
    };
    this.state.groups.push(group);
    this.persist();
    return group;
  }

  private persist() {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(this.state));
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OpenJobApp auth={new FixtureAuth()} api={new FixtureApi()} />
  </StrictMode>,
);
