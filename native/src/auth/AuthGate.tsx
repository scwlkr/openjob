import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { OpenJobRuntimeConfig } from "../runtime-config";
import type { NativeTaskListController } from "../task-list-contracts";
import { useOpenJobTheme } from "../theme";
import {
  type AuthFlowResult,
  NativeAuthCoordinator,
  OpenJobApiError,
  ProviderSignInError,
  type AuthenticationMethod,
  type SignedInResult,
} from "./coordinator";
import { createNativeAuthController } from "./dependencies";

export type { AuthFlowResult, SignedInResult } from "./coordinator";

export type NativeAuthController = Pick<
  NativeAuthCoordinator,
  | "acknowledgeDeletionCompletion"
  | "authenticateExistingUser"
  | "authenticateNewMethod"
  | "cancelPending"
  | "claimUsername"
  | "confirmLink"
  | "createUser"
  | "deleteUser"
  | "listGroups"
  | "loadCachedTaskList"
  | "purgeCachedTaskList"
  | "readTaskList"
  | "revokeSession"
  | "restore"
  | "restoreCachedSession"
  | "saveCachedTaskList"
  | "signIn"
  | "signInWithQaPassword"
  | "signOut"
  | "subscribeToCredentialRevocation"
  | "syncTaskList"
  | "switchUser"
> & {
  reauthenticateDeletionProvider?:
    NativeAuthCoordinator["reauthenticateDeletionProvider"];
  refreshDeletionStatus?: NativeAuthCoordinator["refreshDeletionStatus"];
};

type SignedInViewProps = {
  onManageSignInMethods?: () => void;
  onRestoreSession: () => void;
  onSessionRevoked: () => void;
  onSignOut: () => void;
  onSwitchUser: () => void;
  result: SignedInResult;
  restoreReason?: "offline" | "unavailable";
  sessionReady: boolean;
  taskListController: NativeTaskListController;
};

type AuthGateState = AuthFlowResult | { kind: "restoring" };

const USERNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])$/u;
const USERNAME_GUIDANCE =
  "2–32 lowercase letters or numbers. Dots, dashes, and underscores can sit inside.";
const USERNAME_VALIDATION =
  "Use 2 to 32 lowercase letters, numbers, or internal ._- characters.";

function methodName(method: AuthenticationMethod) {
  if (method === "qa-password") return "Preview QA";
  return method === "apple" ? "Apple" : "Google";
}

function resultMessage(result: AuthFlowResult) {
  if (result.kind === "deletion-completed") {
    return "Your OpenJob User and associated data were deleted.";
  }
  if (result.kind === "deletion-clear-retry") {
    return result.status === "completed"
      ? "Deletion is complete, but OpenJob could not remove its protected receipt. Retry before signing in."
      : "Deletion did not start, but OpenJob could not remove its protected preparation receipt. Retry before continuing.";
  }
  if (result.kind === "deletion-pending") {
    if (result.reauthenticationProviders.length > 0) {
      const names = result.reauthenticationProviders.map(methodName).join(" and ");
      return `Deletion is in progress. Reauthenticate ${names} so provider cleanup can resume.`;
    }
    if (Date.parse(result.deadline) <= Date.now()) {
      return "Automatic cleanup ended. OpenJob operator completion is required; access remains blocked.";
    }
    return "Deletion is in progress. Access ended, and cleanup will finish within seven days.";
  }
  if (result.kind === "deletion-status-retry") {
    if (result.reason === "proof-retry") {
      return "OpenJob could not resume deletion yet. Fresh provider proof remains only while this app stays open; retry now.";
    }
    if (result.reason === "offline") {
      return "OpenJob is offline. Your protected deletion receipt remains on this device.";
    }
    if (result.reason === "storage-unavailable") {
      return "OpenJob could not save the protected deletion receipt. Keep the app open and retry now.";
    }
    return "OpenJob could not confirm deletion status. Your protected receipt remains on this device.";
  }
  if (
    (result.kind === "signed-in" || result.kind === "unrecognized") &&
    result.notice === "fresh_authentication_required"
  ) {
    return "The second sign-in expired. Authenticate it again.";
  }
  if (
    (result.kind === "signed-in" || result.kind === "unrecognized") &&
    result.notice === "link_target_changed"
  ) {
    return "That User changed. Authenticate again and confirm the current User.";
  }
  if (result.kind !== "signed-out" || !result.reason) return null;
  switch (result.reason) {
    case "cancelled":
      return "Sign-in was canceled. Nothing changed.";
    case "deleted":
      return "Your OpenJob User and associated data were deleted.";
    case "deletion-pending":
      return "Deletion is in progress. Sign in again with Google or Apple to resume provider cleanup; access remains blocked.";
    case "expired":
      return "The initial sign-in expired. Sign in again to restart linking.";
    case "interrupted":
      return "Another sign-in is already in progress. Try again.";
    case "revoked":
      return "That saved sign-in expired. Sign in again.";
    case "unavailable":
      return "That provider is unavailable right now. Try again.";
  }
}

function errorMessage(error: unknown) {
  if (error instanceof ProviderSignInError) {
    if (error.code === "offline") {
      return "OpenJob is offline. Check your connection and try again.";
    }
    return (
      resultMessage({ kind: "signed-out", reason: error.code }) ??
      "Sign-in could not be completed."
    );
  }
  if (error instanceof OpenJobApiError) {
    if (error.code === "username_taken") {
      return "That Username is unavailable. Try another.";
    }
    if (error.code === "sign_in_method_conflict") {
      return "That Sign-in Method belongs to another User and cannot be linked.";
    }
    if (error.code === "fresh_authentication_required") {
      return "The second sign-in expired. Authenticate it again.";
    }
    return error.message;
  }
  return "OpenJob could not complete sign-in. Try again.";
}

function ActionButton({
  accessibilityHint,
  disabled = false,
  label,
  onPress,
  secondary = false,
}: {
  accessibilityHint?: string;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  const { palette } = useOpenJobTheme();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary
            ? pressed || hovered
              ? palette.card
              : palette.paper
            : pressed || hovered
              ? palette.blueStrong
              : palette.blue,
          borderColor: focused ? palette.ink : secondary ? palette.line : palette.blue,
          borderWidth: focused ? 3 : 1,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          { color: secondary ? palette.ink : palette.onBlue },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AuthScaffold({
  children,
  diagnosticsSetting,
  message,
  title,
}: {
  children: ReactNode;
  diagnosticsSetting?: ReactNode;
  message?: string | null;
  title: string;
}) {
  const { palette } = useOpenJobTheme();
  return (
    <SafeAreaView
      edges={["top", "right", "bottom", "left"]}
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: palette.paper,
              borderColor: palette.ink,
              shadowColor: palette.blue,
            },
          ]}
        >
          <Text style={[styles.wordmark, { color: palette.ink }]}>OPENJOB.</Text>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: palette.ink }]}
          >
            {title}
          </Text>
          {message ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.message, { color: palette.muted }]}
            >
              {message}
            </Text>
          ) : null}
          <View style={styles.actions}>{children}</View>
          {diagnosticsSetting}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function UsernameClaimForm({
  busy,
  error,
  onClaim,
  onDraftChange,
}: {
  busy: boolean;
  error: string | null;
  onClaim: (username: string) => void;
  onDraftChange: () => void;
}) {
  const [username, setUsername] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const { palette } = useOpenJobTheme();
  const status = validation ?? error;

  useEffect(() => {
    if (status) {
      AccessibilityInfo.announceForAccessibility(status);
    }
  }, [status]);

  function claimCurrentUsername() {
    if (busy) return;
    if (!USERNAME_PATTERN.test(username)) {
      setValidation(USERNAME_VALIDATION);
      return;
    }
    setValidation(null);
    onClaim(username);
  }

  return (
    <View style={styles.usernameForm}>
      <Text style={[styles.inputLabel, { color: palette.ink }]}>
        Username
      </Text>
      <View style={styles.usernameInputRow}>
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.usernamePrefix, { color: palette.ink }]}
        >
          @
        </Text>
        <TextInput
          accessibilityHint={USERNAME_GUIDANCE}
          accessibilityLabel="Username"
          autoCapitalize="none"
          autoComplete="username"
          autoCorrect={false}
          editable={!busy}
          onChangeText={(value) => {
            setUsername(value);
            setValidation(null);
            onDraftChange();
          }}
          onSubmitEditing={claimCurrentUsername}
          placeholder="username"
          placeholderTextColor={palette.muted}
          returnKeyType="done"
          spellCheck={false}
          style={[
            styles.input,
            styles.usernameInput,
            {
              backgroundColor: palette.paper,
              borderColor: palette.line,
              color: palette.ink,
            },
          ]}
          textContentType="username"
          value={username}
        />
      </View>
      <Text style={[styles.guidance, { color: palette.muted }]}>
        {USERNAME_GUIDANCE}
      </Text>
      {status ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[styles.message, { color: palette.muted }]}
        >
          {status}
        </Text>
      ) : null}
      <ActionButton
        disabled={busy || username.length === 0}
        label={busy ? "Claiming…" : "Claim Username"}
        onPress={claimCurrentUsername}
      />
    </View>
  );
}

export function NativeAuthGate({
  controller,
  diagnosticsSetting,
  renderSignedIn,
  runtimeConfig,
}: {
  controller?: NativeAuthController;
  diagnosticsSetting?: ReactNode;
  renderSignedIn: (props: SignedInViewProps) => ReactNode;
  runtimeConfig: OpenJobRuntimeConfig;
}) {
  const auth = useMemo(
    () => controller ?? createNativeAuthController(runtimeConfig),
    [controller, runtimeConfig],
  );
  const [state, setState] = useState<AuthGateState>({ kind: "restoring" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [linkFromManager, setLinkFromManager] = useState(false);
  const [qaEmail, setQaEmail] = useState("");
  const [qaPassword, setQaPassword] = useState("");
  const { palette } = useOpenJobTheme();
  const qaPasswordEnabled =
    runtimeConfig.environment === "preview" &&
    runtimeConfig.qaPasswordTenantId !== null;

  async function perform(
    operation: () => Promise<AuthFlowResult>,
    options: { keepManager?: boolean } = {},
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await operation();
      setState(result);
      setMessage(resultMessage(result));
      setManaging(result.kind === "signed-in" && Boolean(options.keepManager));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function retryRestore() {
    const fallback =
      state.kind === "signed-in" && state.provisional ? state : null;
    setBusy(true);
    setMessage(null);
    try {
      const result = await auth.restore();
      if (result.kind === "restore-retry" && fallback) {
        setState({ ...fallback, restoreReason: result.reason });
        setMessage(resultMessage(result));
      } else {
        setState(result);
        setMessage(resultMessage(result));
      }
    } catch (error) {
      if (fallback) setState(fallback);
      else setState({ kind: "signed-out" });
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function refreshDeletionStatus() {
    return auth.refreshDeletionStatus?.() ?? auth.restore();
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      let cached: SignedInResult | null = null;
      try {
        cached = await auth.restoreCachedSession();
        if (mounted && cached) setState(cached);
      } catch {
        cached = null;
      }
      try {
        const result = await auth.restore();
        if (!mounted) return;
        if (cached && result.kind === "restore-retry") {
          setState({ ...cached, restoreReason: result.reason });
          setMessage(resultMessage(result));
          return;
        }
        setState(result);
        setMessage(resultMessage(result));
      } catch (error) {
        if (!mounted) return;
        if (cached) setState(cached);
        else setState({ kind: "signed-out" });
        setMessage(errorMessage(error));
      } finally {
        if (mounted) setBusy(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [auth]);

  useEffect(
    () =>
      auth.subscribeToCredentialRevocation((result) => {
        setState(result);
        setMessage(resultMessage(result));
        setManaging(false);
      }),
    [auth],
  );

  if (state.kind === "restoring") {
    return (
      <AuthScaffold
        diagnosticsSetting={diagnosticsSetting}
        title="Restoring your sign-in"
      >
        <ActivityIndicator accessibilityLabel="Restoring sign-in" />
      </AuthScaffold>
    );
  }

  if (state.kind === "deletion-pending") {
    return (
      <AuthScaffold
        diagnosticsSetting={diagnosticsSetting}
        message={message ?? resultMessage(state)}
        title="Deletion in progress"
      >
        <Text style={[styles.message, { color: palette.muted }]}>
          {`Cleanup deadline: ${state.deadline}`}
        </Text>
        {state.reauthenticationProviders.map((provider) => (
          <ActionButton
            disabled={busy}
            key={provider}
            label={
              busy
                ? `Reauthenticating ${methodName(provider)}…`
                : `Reauthenticate ${methodName(provider)}`
            }
            onPress={() =>
              void perform(() =>
                auth.reauthenticateDeletionProvider?.(provider) ??
                  refreshDeletionStatus(),
              )
            }
          />
        ))}
        <ActionButton
          disabled={busy}
          label={busy ? "Refreshing…" : "Refresh deletion status"}
          onPress={() =>
            void perform(() => refreshDeletionStatus())
          }
        />
      </AuthScaffold>
    );
  }

  if (state.kind === "deletion-clear-retry") {
    return (
      <AuthScaffold
        diagnosticsSetting={diagnosticsSetting}
        message={message ?? resultMessage(state)}
        title={
          state.status === "completed"
            ? "Finish confirming deletion"
            : "Finish canceling deletion"
        }
      >
        <ActionButton
          disabled={busy}
          label={busy ? "Retrying…" : "Retry deletion confirmation"}
          onPress={() =>
            void perform(() =>
              state.status === "completed"
                ? auth.acknowledgeDeletionCompletion()
                : refreshDeletionStatus(),
            )
          }
        />
      </AuthScaffold>
    );
  }

  if (state.kind === "deletion-status-retry") {
    return (
      <AuthScaffold
        diagnosticsSetting={diagnosticsSetting}
        message={message ?? resultMessage(state)}
        title="Confirm deletion status"
      >
        <ActionButton
          disabled={busy}
          label={busy ? "Refreshing…" : "Refresh deletion status"}
          onPress={() =>
            void perform(() => refreshDeletionStatus())
          }
        />
      </AuthScaffold>
    );
  }

  if (state.kind === "deletion-completed") {
    return (
      <AuthScaffold
        diagnosticsSetting={diagnosticsSetting}
        message={message ?? resultMessage(state)}
        title="Deletion complete"
      >
        <ActionButton
          disabled={busy}
          label={busy ? "Continuing…" : "Continue to sign in"}
          onPress={() =>
            void perform(() => auth.acknowledgeDeletionCompletion())
          }
        />
      </AuthScaffold>
    );
  }

  if (state.kind === "offline") {
    return (
      <AuthScaffold
        diagnosticsSetting={diagnosticsSetting}
        message="OpenJob is offline. Nothing changed."
        title="Reconnect to OpenJob"
      >
        <ActionButton
          disabled={busy}
          label="Retry sign-in"
          onPress={() => void perform(() => auth.signIn(state.provider))}
        />
        <ActionButton
          disabled={busy}
          label="Cancel"
          onPress={() => void perform(() => auth.cancelPending())}
          secondary
        />
      </AuthScaffold>
    );
  }

  if (state.kind === "restore-retry") {
    const offline = state.reason === "offline";
    return (
      <AuthScaffold
        diagnosticsSetting={diagnosticsSetting}
        message={
          offline
            ? "OpenJob is offline. Your protected sign-in is still on this device."
            : "OpenJob could not restore your protected sign-in. Nothing was removed."
        }
        title={offline ? "Reconnect to OpenJob" : "Restore your sign-in"}
      >
        <ActionButton
          disabled={busy}
          label="Retry sign-in"
          onPress={() => void perform(() => auth.restore())}
        />
        <ActionButton
          disabled={busy}
          label="Remove saved sign-in"
          onPress={() => void perform(() => auth.signOut())}
          secondary
        />
      </AuthScaffold>
    );
  }

  if (state.kind === "cleanup-retry") {
    return (
      <AuthScaffold
        diagnosticsSetting={diagnosticsSetting}
        message="OpenJob could not finish protected local cleanup. Retry before signing in again."
        title="Finish signing out"
      >
        <ActionButton
          disabled={busy}
          label="Retry cleanup"
          onPress={() => void perform(() => auth.signOut())}
        />
      </AuthScaffold>
    );
  }

  if (state.kind === "unrecognized") {
    const name = methodName(state.provider);
    const qaPassword = state.provider === "qa-password";
    return (
      <AuthScaffold
        diagnosticsSetting={diagnosticsSetting}
        message={
          message ??
          (qaPassword
            ? "This Preview QA credential is not provisioned. Use the maintained QA Two credential or ask the fixture operator to restore its binding."
            : "Choose deliberately. OpenJob will not merge Users from an email address.")
        }
        title={`This ${name} sign-in is not linked yet`}
      >
        {!qaPassword ? (
          <>
            <ActionButton
              disabled={busy}
              label="Create a new OpenJob User"
              onPress={() => void perform(() => auth.createUser())}
            />
            <ActionButton
              disabled={busy}
              label="Link to an existing User"
              onPress={() => {
                setLinkFromManager(false);
                void perform(() => auth.authenticateExistingUser());
              }}
              secondary
            />
          </>
        ) : null}
        <ActionButton
          disabled={busy}
          label="Cancel"
          onPress={() => void perform(() => auth.cancelPending())}
          secondary
        />
      </AuthScaffold>
    );
  }

  if (state.kind === "confirm-link") {
    const target = state.user.username
      ? `@${state.user.username}`
      : state.user.userId;
    return (
      <AuthScaffold
        diagnosticsSetting={diagnosticsSetting}
        message={
          message ??
          `Keep ${target}'s User ID, Username, Groups, and Tasks. Add ${methodName(state.newProvider)} only as another way to sign in.`
        }
        title={`Link ${methodName(state.newProvider)} to ${target}?`}
      >
        <ActionButton
          accessibilityHint={`Keeps ${target}'s User ID, Username, Groups, and Tasks and adds ${methodName(state.newProvider)} as another sign-in method.`}
          disabled={busy}
          label="Confirm link"
          onPress={() =>
            void perform(() => auth.confirmLink(), {
              keepManager: linkFromManager,
            })
          }
        />
        <ActionButton
          disabled={busy}
          label="Cancel link"
          onPress={() =>
            void perform(() => auth.cancelPending(), {
              keepManager: linkFromManager,
            })
          }
          secondary
        />
      </AuthScaffold>
    );
  }

  if (state.kind === "signed-in" && state.user.usernameRequired) {
    const methodToLink =
      state.methods.length === 1
        ? state.methods[0] === "google"
          ? "apple"
          : "google"
        : null;
    return (
      <AuthScaffold
        diagnosticsSetting={diagnosticsSetting}
        title="Claim your Username"
      >
        <Text style={[styles.onboardingText, { color: palette.muted }]}>
          Members will use it to recognize you and assign work. You choose it
          once.
        </Text>
        <UsernameClaimForm
          busy={busy}
          error={message}
          key={state.user.userId}
          onClaim={(username) =>
            void perform(() => auth.claimUsername(username))
          }
          onDraftChange={() => setMessage(null)}
        />
        {methodToLink ? (
          <ActionButton
            disabled={busy}
            label="Link an existing User"
            onPress={() => {
              setLinkFromManager(false);
              void perform(() =>
                auth.authenticateNewMethod(methodToLink),
              );
            }}
            secondary
          />
        ) : null}
        <ActionButton
          disabled={busy}
          label="Sign out"
          onPress={() => void perform(() => auth.signOut())}
          secondary
        />
        <ActionButton
          disabled={busy}
          label="Switch User"
          onPress={() => void perform(() => auth.switchUser())}
          secondary
        />
      </AuthScaffold>
    );
  }

  if (state.kind === "signed-in") {
    if (!managing) {
      return renderSignedIn({
        onManageSignInMethods:
          state.methods.length === 0 ? undefined : () => setManaging(true),
        onRestoreSession: () => void retryRestore(),
        onSessionRevoked: () => void perform(() => auth.revokeSession()),
        onSignOut: () => void perform(() => auth.signOut()),
        onSwitchUser: () => void perform(() => auth.switchUser()),
        result: state,
        restoreReason: state.restoreReason,
        sessionReady: !state.provisional,
        taskListController: auth,
      });
    }

    if (deleting) {
      return (
        <AuthScaffold
          diagnosticsSetting={diagnosticsSetting}
          message="This permanently deletes your User, Tasks you created, linked sign-ins, notifications, and Group access. Other Members keep shared Groups."
          title="Delete User"
        >
          <Text style={[styles.message, { color: palette.ink }]}>
            Fresh authentication opens for every linked Sign-in Method after
            you confirm. Access ends immediately when the request starts.
          </Text>
          {message ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.message, { color: palette.muted }]}
            >
              {message}
            </Text>
          ) : null}
          <Text style={[styles.inputLabel, { color: palette.ink }]}>
            Type DELETE to confirm permanent deletion
          </Text>
          <TextInput
            accessibilityLabel="Type DELETE to confirm permanent deletion"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            onChangeText={setDeletionConfirmation}
            style={[
              styles.input,
              {
                backgroundColor: palette.paper,
                borderColor: palette.line,
                color: palette.ink,
              },
            ]}
            value={deletionConfirmation}
          />
          <ActionButton
            accessibilityHint="Permanently deletes this User and cannot be undone"
            disabled={busy || deletionConfirmation !== "DELETE"}
            label={busy ? "Deleting…" : "Permanently delete User"}
            onPress={() => void perform(() => auth.deleteUser())}
          />
          <ActionButton
            disabled={busy}
            label="Cancel deletion"
            onPress={() => {
              setDeletionConfirmation("");
              setDeleting(false);
            }}
            secondary
          />
        </AuthScaffold>
      );
    }

    return (
      <AuthScaffold
        diagnosticsSetting={diagnosticsSetting}
        message="A linked method opens this same User. Email addresses never merge Users."
        title="Sign-in Methods"
      >
        {(["apple", "google"] as const).map((method) => {
          const linked = state.methods.includes(method);
          const name = methodName(method);
          return (
            <View key={method} style={styles.method}>
              <Text style={[styles.methodText, { color: palette.ink }]}>
                {`${name} — ${linked ? "Linked" : "Not linked"}`}
              </Text>
              {!linked ? (
                <ActionButton
                  disabled={busy}
                  label={`Link ${name}`}
                  onPress={() => {
                    setLinkFromManager(true);
                    void perform(() => auth.authenticateNewMethod(method));
                  }}
                  secondary
                />
              ) : null}
            </View>
          );
        })}
        {message ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.message, { color: palette.muted }]}
          >
            {message}
          </Text>
        ) : null}
        <ActionButton
          disabled={busy}
          label="Delete User"
          onPress={() => {
            setDeletionConfirmation("");
            setDeleting(true);
          }}
          secondary
        />
        <ActionButton
          disabled={busy}
          label="Back to OpenJob"
          onPress={() => void perform(() => auth.cancelPending())}
          secondary
        />
        <ActionButton
          disabled={busy}
          label="Sign out"
          onPress={() => void perform(() => auth.signOut())}
          secondary
        />
        <ActionButton
          disabled={busy}
          label="Switch User"
          onPress={() => void perform(() => auth.switchUser())}
          secondary
        />
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      diagnosticsSetting={diagnosticsSetting}
      message={message}
      title="Sign in to your shared Task Lists"
    >
      <ActionButton
        disabled={busy}
        label="Continue with Google"
        onPress={() => void perform(() => auth.signIn("google"))}
      />
      <ActionButton
        disabled={busy}
        label="Continue with Apple"
        onPress={() => void perform(() => auth.signIn("apple"))}
        secondary
      />
      {qaPasswordEnabled &&
      !(
        state.kind === "signed-out" && state.reason === "deletion-pending"
      ) ? (
        <View style={styles.qaForm}>
          <Text style={[styles.qaTitle, { color: palette.ink }]}>
            Preview QA sign-in
          </Text>
          <TextInput
            accessibilityLabel="Preview QA email"
            autoCapitalize="none"
            autoComplete="email"
            editable={!busy}
            keyboardType="email-address"
            onChangeText={setQaEmail}
            placeholder="QA email"
            placeholderTextColor={palette.muted}
            style={[
              styles.input,
              {
                backgroundColor: palette.paper,
                borderColor: palette.line,
                color: palette.ink,
              },
            ]}
            textContentType="emailAddress"
            value={qaEmail}
          />
          <TextInput
            accessibilityLabel="Preview QA password"
            autoCapitalize="none"
            autoComplete="current-password"
            editable={!busy}
            onChangeText={setQaPassword}
            placeholder="QA password"
            placeholderTextColor={palette.muted}
            secureTextEntry
            style={[
              styles.input,
              {
                backgroundColor: palette.paper,
                borderColor: palette.line,
                color: palette.ink,
              },
            ]}
            textContentType="password"
            value={qaPassword}
          />
          <ActionButton
            disabled={
              busy || qaEmail.trim().length === 0 || qaPassword.length === 0
            }
            label="Sign in as Preview QA User"
            onPress={() => {
              const email = qaEmail.trim();
              const password = qaPassword;
              setQaPassword("");
              void perform(() =>
                auth.signInWithQaPassword(email, password),
              );
            }}
            secondary
          />
        </View>
      ) : null}
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
    marginTop: 28,
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  buttonText: {
    fontFamily: "Geist_700Bold",
    fontSize: 15,
    textAlign: "center",
  },
  card: {
    borderWidth: 1,
    maxWidth: 560,
    padding: 28,
    shadowOffset: { height: 10, width: 10 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: "100%",
  },
  message: {
    fontFamily: "Geist_400Regular",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 16,
  },
  method: {
    gap: 8,
  },
  methodText: {
    fontFamily: "Geist_400Regular",
    fontSize: 16,
  },
  input: {
    borderWidth: 1,
    fontFamily: "Geist_400Regular",
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputLabel: {
    fontFamily: "Geist_700Bold",
    fontSize: 16,
  },
  guidance: {
    fontFamily: "Geist_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  onboardingText: {
    fontFamily: "Geist_400Regular",
    fontSize: 16,
    lineHeight: 24,
  },
  qaForm: {
    gap: 10,
    marginTop: 12,
  },
  qaTitle: {
    fontFamily: "Geist_700Bold",
    fontSize: 16,
  },
  usernameForm: {
    gap: 10,
  },
  usernameInput: {
    flex: 1,
  },
  usernameInputRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  usernamePrefix: {
    fontFamily: "Geist_700Bold",
    fontSize: 18,
    marginRight: 8,
  },
  safeArea: {
    flex: 1,
  },
  scroll: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontFamily: "Geist_900Black",
    fontSize: 38,
    letterSpacing: -1.7,
    lineHeight: 42,
    marginTop: 28,
  },
  wordmark: {
    fontFamily: "Geist_900Black",
    fontSize: 18,
    letterSpacing: 1.2,
  },
});
