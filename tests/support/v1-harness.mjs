const DEFAULT_NOW = "2026-07-15T12:00:00.000Z";
const DEFAULT_IDENTITIES = {
  shane: {
    userId: "user_shane",
    claims: {
      aud: "openjob-dev",
      auth_time: 1_784_116_800,
      exp: 1_784_120_400,
      firebase: { sign_in_provider: "google.com" },
      iat: 1_784_116_800,
      iss: "https://securetoken.google.com/openjob-dev",
      sub: "firebase_shane",
      user_id: "firebase_shane",
    },
  },
  eli: {
    userId: "user_eli",
    claims: {
      aud: "openjob-dev",
      auth_time: 1_784_116_800,
      exp: 1_784_120_400,
      firebase: { sign_in_provider: "google.com" },
      iat: 1_784_116_800,
      iss: "https://securetoken.google.com/openjob-dev",
      sub: "firebase_eli",
      user_id: "firebase_eli",
    },
  },
};

export class LegacyTaskCollectionAccessError extends Error {
  constructor() {
    super("The v1 test harness cannot access the legacy top-level Task collection.");
    this.name = "LegacyTaskCollectionAccessError";
    this.code = "LEGACY_TASK_COLLECTION_ACCESS";
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function validatePath(path) {
  if (
    !Array.isArray(path) ||
    path.length === 0 ||
    path.some((segment) => typeof segment !== "string" || !segment)
  ) {
    throw new TypeError("State paths must be a non-empty array of strings.");
  }
  if (path[0] === "tasks") {
    throw new LegacyTaskCollectionAccessError();
  }
}

function pathKey(path) {
  validatePath(path);
  return path.map((segment) => encodeURIComponent(segment)).join("/");
}

function createStateAccess(records) {
  return Object.freeze({
    async get(path) {
      return clone(records.get(pathKey(path)));
    },
    async put(path, value) {
      records.set(pathKey(path), clone(value));
    },
    async delete(path) {
      return records.delete(pathKey(path));
    },
    async list(prefix) {
      const keyPrefix = `${pathKey(prefix)}/`;
      return [...records.entries()]
        .filter(([key]) => key.startsWith(keyPrefix))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => ({ key, value: clone(value) }));
    },
  });
}

function createIsolatedState() {
  const records = new Map();
  let transactionQueue = Promise.resolve();
  const access = createStateAccess(records);

  return Object.freeze({
    ...access,
    async transaction(callback) {
      const previous = transactionQueue;
      let release;
      transactionQueue = new Promise((resolve) => {
        release = resolve;
      });
      await previous;

      const draft = new Map(records);
      try {
        const result = await callback(createStateAccess(draft));
        records.clear();
        for (const entry of draft) records.set(...entry);
        return result;
      } finally {
        release();
      }
    },
    async clear() {
      records.clear();
    },
  });
}

function createClock(initialNow) {
  let now = Date.parse(initialNow);
  if (!Number.isFinite(now)) throw new TypeError("initialNow must be an ISO timestamp.");

  return {
    controls: Object.freeze({ now: () => new Date(now).toISOString() }),
    set(value) {
      const next = Date.parse(value);
      if (!Number.isFinite(next)) throw new TypeError("now must be an ISO timestamp.");
      now = next;
    },
    advance(milliseconds) {
      if (!Number.isFinite(milliseconds)) {
        throw new TypeError("milliseconds must be finite.");
      }
      now += milliseconds;
    },
  };
}

function createIdentityControls(identityDefinitions) {
  const identities = new Map();
  const tokens = new Map();

  for (const [name, identity] of Object.entries(identityDefinitions)) {
    const frozenIdentity = Object.freeze(clone(identity));
    const token = `openjob-test-token:${name}`;
    identities.set(name, frozenIdentity);
    tokens.set(token, frozenIdentity);
  }
  if (identities.size < 2) {
    throw new TypeError("The v1 harness requires at least two test identities.");
  }

  return {
    controls: Object.freeze({
      authenticate(request) {
        const header = request.headers.get("authorization");
        if (!header?.startsWith("Bearer ")) return null;
        const matched = tokens.get(header.slice("Bearer ".length));
        return matched ? clone(matched) : null;
      },
      all() {
        return [...identities.values()].map(clone);
      },
    }),
    tokenFor(name) {
      if (!identities.has(name)) {
        throw new TypeError(`Unknown v1 test identity: ${name}.`);
      }
      return `openjob-test-token:${name}`;
    },
  };
}

function createExecutionContext() {
  const pending = [];
  return {
    context: {
      passThroughOnException() {},
      props: {},
      waitUntil(promise) {
        pending.push(Promise.resolve(promise));
      },
    },
    async settle() {
      await Promise.all(pending);
    },
  };
}

async function stopWorker(worker) {
  if (typeof worker?.close === "function") {
    await worker.close();
  } else if (typeof worker?.[Symbol.asyncDispose] === "function") {
    await worker[Symbol.asyncDispose]();
  }
}

export function createV1TestHarness({
  createWorker,
  identities = DEFAULT_IDENTITIES,
  initialNow = DEFAULT_NOW,
} = {}) {
  if (typeof createWorker !== "function") {
    throw new TypeError("createWorker must return a Worker-style fetch handler.");
  }

  const state = createIsolatedState();
  const clock = createClock(initialNow);
  const identity = createIdentityControls(identities);
  const controls = Object.freeze({
    clock: clock.controls,
    identities: identity.controls,
    state,
  });
  let closed = false;
  let workerPromise = startWorker();

  async function startWorker() {
    const worker = await createWorker(controls);
    if (!worker || typeof worker.fetch !== "function") {
      throw new TypeError("createWorker must return an object with fetch(request).");
    }
    return worker;
  }

  return Object.freeze({
    async request({ as, body, headers: providedHeaders, method = "GET", path }) {
      if (closed) throw new Error("The v1 test harness is closed.");
      const url =
        typeof path === "string" ? new URL(path, "https://openjob.test") : null;
      if (
        !url ||
        (url.pathname !== "/api/v1" && !url.pathname.startsWith("/api/v1/"))
      ) {
        throw new TypeError("Harness requests must target /api/v1.");
      }

      const headers = new Headers(providedHeaders);
      if (as !== undefined && as !== null) {
        headers.set("authorization", `Bearer ${identity.tokenFor(as)}`);
      }
      let requestBody;
      if (body !== undefined) {
        headers.set("content-type", "application/json");
        requestBody = JSON.stringify(body);
      }

      const request = new Request(url, {
        body: requestBody,
        headers,
        method,
      });
      const execution = createExecutionContext();
      const response = await (await workerPromise).fetch(
        request,
        controls,
        execution.context,
      );
      await execution.settle();
      if (!(response instanceof Response)) {
        throw new TypeError("The Worker must return a Response.");
      }
      return response;
    },
    setNow(value) {
      clock.set(value);
    },
    advance(milliseconds) {
      clock.advance(milliseconds);
    },
    async restart() {
      if (closed) throw new Error("The v1 test harness is closed.");
      await stopWorker(await workerPromise);
      workerPromise = startWorker();
      await workerPromise;
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await stopWorker(await workerPromise);
      } finally {
        await state.clear();
      }
    },
  });
}
