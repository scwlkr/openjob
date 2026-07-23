import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { OpenJobRuntimeConfig } from "../runtime-config";
import { useOpenJobTheme } from "../theme";
import {
  type AuthFlowResult,
  NativeAuthCoordinator,
  OpenJobApiError,
  ProviderSignInError,
  type SignedInResult,
  type SignInMethod,
} from "./coordinator";
import { createNativeAuthController } from "./dependencies";

export type { AuthFlowResult, SignedInResult } from "./coordinator";

export type NativeAuthController = Pick<
  NativeAuthCoordinator,
  | "authenticateExistingUser"
  | "authenticateNewMethod"
  | "cancelPending"
  | "confirmLink"
  | "createUser"
  | "restore"
  | "signIn"
  | "signOut"
  | "subscribeToCredentialRevocation"
  | "switchUser"
>;

type SignedInViewProps = {
  onManageSignInMethods: () => void;
  onSignOut: () => void;
  onSwitchUser: () => void;
  result: SignedInResult;
};

type AuthGateState = AuthFlowResult | { kind: "restoring" };

function methodName(method: SignInMethod) {
  return method === "apple" ? "Apple" : "Google";
}

function resultMessage(result: AuthFlowResult) {
  if (
    result.kind === "signed-in" &&
    result.notice === "fresh_authentication_required"
  ) {
    return "The second sign-in expired. Authenticate it again.";
  }
  if (
    result.kind === "signed-in" &&
    result.notice === "link_target_changed"
  ) {
    return "That User changed. Authenticate again and confirm the current User.";
  }
  if (result.kind !== "signed-out" || !result.reason) return null;
  switch (result.reason) {
    case "cancelled":
      return "Sign-in was canceled. Nothing changed.";
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
  message,
  title,
}: {
  children: ReactNode;
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
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function NativeAuthGate({
  controller,
  renderSignedIn,
  runtimeConfig,
}: {
  controller?: NativeAuthController;
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
  const [linkFromManager, setLinkFromManager] = useState(false);
  const { palette } = useOpenJobTheme();

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

  useEffect(() => {
    let mounted = true;
    void auth
      .restore()
      .then((result) => {
        if (!mounted) return;
        setState(result);
        setMessage(resultMessage(result));
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setState({ kind: "signed-out" });
        setMessage(errorMessage(error));
      })
      .finally(() => {
        if (mounted) setBusy(false);
      });
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
      <AuthScaffold title="Restoring your sign-in">
        <ActivityIndicator accessibilityLabel="Restoring sign-in" />
      </AuthScaffold>
    );
  }

  if (state.kind === "offline") {
    return (
      <AuthScaffold
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
        message="OpenJob could not finish removing saved data. Retry before signing in again."
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
    return (
      <AuthScaffold
        message={
          message ??
          "Choose deliberately. OpenJob will not merge Users from an email address."
        }
        title={`This ${name} sign-in is not linked yet`}
      >
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

  if (state.kind === "signed-in") {
    if (!managing) {
      return renderSignedIn({
        onManageSignInMethods: () => setManaging(true),
        onSignOut: () => void perform(() => auth.signOut()),
        onSwitchUser: () => void perform(() => auth.switchUser()),
        result: state,
      });
    }

    return (
      <AuthScaffold
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
