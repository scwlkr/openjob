import { createRoot } from "react-dom/client";
import { useState } from "react";
import type { AuthSession, OpenJobAuth, SignInMethod } from "../../../app/openjob-contracts";
import PersonalWorkspaceApp from "../../../app/workspace/personal-workspace-app";
import "../../../app/globals.css";

let owner = sessionStorage.getItem("personal-test-owner") || "alex";
let session: AuthSession | null = null;
let listener: ((value: AuthSession | null) => void) | undefined;
let generation = 0;
let gate: { promise: Promise<void>; release: () => void } | undefined;
let waiting: (() => void) | undefined;
let disposed = 0;

async function selectOwner(next: string) {
  const epoch = ++generation;
  owner = next; sessionStorage.setItem("personal-test-owner", next);
  const response = await fetch(`/__test/session/${next}`);
  const data = await response.json() as { token: string };
  if (epoch !== generation) return;
  session = { signInMethod: "google", getIdToken: async () => {
    const deferred = gate; gate = undefined;
    if (deferred) { waiting = deferred.release; await deferred.promise; }
    return data.token;
  } };
  listener?.(session);
}
const auth: OpenJobAuth = {
  qaPasswordEnabled: false,
  observe(next, onError) { listener = next; selectOwner(owner).catch(onError); return () => { if (listener === next) listener = undefined; }; },
  async signIn(method: SignInMethod) { await selectOwner(owner); return { signInMethod: method, getIdToken: async () => "unused-fixture-proof", getRevocationProof: async () => { throw new Error("Not used in this fixture"); }, dispose: async () => { disposed += 1; } } as Awaited<ReturnType<OpenJobAuth["signIn"]>>; },
  async signOut() { generation += 1; session = null; listener?.(null); },
  async switchUser() { await selectOwner(owner === "alex" ? "sam" : "alex"); },
  async signInWithQaPassword() { throw new Error("Not used in this fixture"); },
  async authenticateForLink() { throw new Error("Not used in this fixture"); },
};
const fixture = {
  deferNextToken() { let release!: () => void; gate = { promise: new Promise<void>((resolve) => { release = resolve; }), release: () => release() }; },
  releaseToken() { waiting?.(); waiting = undefined; },
  get tokenIsWaiting() { return Boolean(waiting); },
  get disposedProofs() { return disposed; },
};
declare global { interface Window { personalWorkspaceFixture: typeof fixture } }
window.personalWorkspaceFixture = fixture;

function Harness() {
  const [selected, setSelected] = useState(owner);
  return <><label style={{ display: "block", padding: 12 }}>Test identity<select aria-label="Test identity" value={selected} onChange={(event) => { setSelected(event.target.value); selectOwner(event.target.value); }}><option value="alex">Alex</option><option value="sam">Sam</option></select></label><PersonalWorkspaceApp auth={auth} /></>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
