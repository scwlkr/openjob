import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { Pressable, Text, View } from "react-native";
import { NativeAuthGate } from "../src/auth/AuthGate";
import { OpenJobApiError } from "../src/auth/coordinator";
import type {
  AuthFlowResult,
  NativeAuthController,
  SignedInResult,
} from "../src/auth/AuthGate";
import type { OpenJobRuntimeConfig } from "../src/runtime-config";
import { OpenJobThemeProvider } from "../src/theme";

const runtimeConfig: OpenJobRuntimeConfig = {
  apiBasePath: "/api/v1",
  apiBaseUrl:
    "https://openjob-preview.walkerworlddiscord.workers.dev/api/v1",
  appleRedirectUri:
    "https://openjob-nonprod.firebaseapp.com/__/auth/handler",
  appleServiceId: "dev.openjob.auth.nonprod",
  environment: "preview",
  environmentBadge: "Preview",
  firebaseApiKey: "public-key",
  firebaseAuthDomain: "openjob-nonprod.firebaseapp.com",
  googleIosClientId: "ios.apps.googleusercontent.com",
  googleWebClientId: "web.apps.googleusercontent.com",
  keychainService: "dev.openjob.app.preview.auth",
  qaPasswordTenantId: "OpenJob-QA-Two-mvz9m",
  releaseVersion: "0.3.3",
  sessionStorageKey: "openjob.native.auth.preview.v1",
};
const user = {
  userId: "usr_one",
  username: "walker",
  usernameRequired: false,
};
const signedIn: SignedInResult = {
  kind: "signed-in",
  methods: ["google"],
  user,
};

function controller(
  overrides: Partial<NativeAuthController> = {},
): NativeAuthController & {
  authenticateExistingUser: jest.Mock;
  authenticateNewMethod: jest.Mock;
  cancelPending: jest.Mock;
  confirmLink: jest.Mock;
  createUser: jest.Mock;
  restore: jest.Mock;
  signIn: jest.Mock;
  signInWithQaPassword: jest.Mock;
  signOut: jest.Mock;
  subscribeToCredentialRevocation: jest.Mock;
  switchUser: jest.Mock;
} {
  return {
    authenticateExistingUser: jest.fn(async () => signedIn),
    authenticateNewMethod: jest.fn(async () => signedIn),
    cancelPending: jest.fn(async () => ({ kind: "signed-out" })),
    confirmLink: jest.fn(async () => signedIn),
    createUser: jest.fn(async () => signedIn),
    restore: jest.fn(async () => ({ kind: "signed-out" })),
    signIn: jest.fn(async () => signedIn),
    signInWithQaPassword: jest.fn(async () => signedIn),
    signOut: jest.fn(async () => ({ kind: "signed-out" })),
    subscribeToCredentialRevocation: jest.fn(() => () => undefined),
    switchUser: jest.fn(async () => ({ kind: "signed-out" })),
    ...overrides,
  } as unknown as ReturnType<typeof controller>;
}

function SignedInSurface({
  onManageSignInMethods,
  onSignOut,
  onSwitchUser,
  result,
}: {
  onManageSignInMethods?: () => void;
  onSignOut: () => void;
  onSwitchUser: () => void;
  result: SignedInResult;
}) {
  return (
    <View>
      <Text>
        {`Signed in as ${result.user.username ?? result.user.userId}`}
      </Text>
      {onManageSignInMethods ? (
        <Pressable
          accessibilityLabel="Manage Sign-in Methods"
          accessibilityRole="button"
          onPress={onManageSignInMethods}
        />
      ) : null}
      <Pressable
        accessibilityLabel="Sign out"
        accessibilityRole="button"
        onPress={onSignOut}
      />
      <Pressable
        accessibilityLabel="Switch User"
        accessibilityRole="button"
        onPress={onSwitchUser}
      />
    </View>
  );
}

async function renderGate(
  auth: NativeAuthController,
  preference: "dark" | "light" = "light",
  config: OpenJobRuntimeConfig = runtimeConfig,
) {
  return render(
    <OpenJobThemeProvider preference={preference} setPreference={jest.fn()}>
      <NativeAuthGate
        controller={auth}
        renderSignedIn={(props) => <SignedInSurface {...props} />}
        runtimeConfig={config}
      />
    </OpenJobThemeProvider>,
  );
}

test("restores either linked provider before rendering the signed-in surface", async () => {
  const auth = controller({
    restore: jest.fn(async () => ({
      ...signedIn,
      methods: ["apple" as const],
    })),
  });

  await renderGate(auth);

  expect(await screen.findByText("Signed in as walker")).toBeOnTheScreen();
  expect(auth.restore).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Continue with Google")).not.toBeOnTheScreen();
});

test("requires an explicit create choice for an unknown credential", async () => {
  const auth = controller({
    signIn: jest.fn(async () => ({
      kind: "unrecognized" as const,
      provider: "google" as const,
    })),
  });
  await renderGate(auth);

  await fireEvent.press(
    await screen.findByRole("button", { name: "Continue with Google" }),
  );
  expect(
    await screen.findByRole("header", {
      name: "This Google sign-in is not linked yet",
    }),
  ).toBeOnTheScreen();
  expect(auth.createUser).not.toHaveBeenCalled();

  await fireEvent.press(
    screen.getByRole("button", { name: "Create a new OpenJob User" }),
  );
  expect(await screen.findByText("Signed in as walker")).toBeOnTheScreen();
  expect(auth.createUser).toHaveBeenCalledTimes(1);
});

test("offers accessible password sign-in only in Preview without embedding credentials", async () => {
  const auth = controller({
    signInWithQaPassword: jest.fn(async () => ({
      kind: "signed-in" as const,
      methods: [],
      user,
    })),
  });
  await renderGate(auth);

  const email = await screen.findByLabelText("Preview QA email");
  const password = screen.getByLabelText("Preview QA password");
  const submit = screen.getByRole("button", {
    name: "Sign in as Preview QA User",
  });
  expect(password).toHaveProp("secureTextEntry", true);
  expect(submit).toHaveProp("accessibilityState", { disabled: true });

  await fireEvent.changeText(email, "qa@example.invalid");
  await fireEvent.changeText(password, "fixture-password");
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "Sign in as Preview QA User",
      }),
    ).toHaveProp("accessibilityState", { disabled: false }),
  );
  await fireEvent.press(
    screen.getByRole("button", {
      name: "Sign in as Preview QA User",
    }),
  );

  expect(auth.signInWithQaPassword).toHaveBeenCalledWith(
    "qa@example.invalid",
    "fixture-password",
  );
  expect(await screen.findByText("Signed in as walker")).toBeOnTheScreen();
  expect(screen.queryByDisplayValue("fixture-password")).not.toBeOnTheScreen();
  expect(
    screen.queryByRole("button", { name: "Manage Sign-in Methods" }),
  ).not.toBeOnTheScreen();
});

test.each([
  {
    environment: "development" as const,
    environmentBadge: "Development" as const,
  },
  {
    environment: "production" as const,
    environmentBadge: null,
  },
])("omits Preview QA password sign-in in $environment", async ({
  environment,
  environmentBadge,
}) => {
  const config: OpenJobRuntimeConfig = {
    ...runtimeConfig,
    environment,
    environmentBadge,
    qaPasswordTenantId: null,
  };

  await renderGate(controller(), "light", config);

  expect(
    await screen.findByRole("button", { name: "Continue with Google" }),
  ).toBeOnTheScreen();
  expect(screen.queryByText("Preview QA sign-in")).not.toBeOnTheScreen();
  expect(screen.queryByLabelText("Preview QA email")).not.toBeOnTheScreen();
});

test("requires explicit creation and never offers linking for unknown Preview QA credentials", async () => {
  const auth = controller({
    signInWithQaPassword: jest.fn(async () => ({
      kind: "unrecognized" as const,
      provider: "qa-password" as const,
    })),
  });
  await renderGate(auth);

  await fireEvent.changeText(
    await screen.findByLabelText("Preview QA email"),
    "qa@example.invalid",
  );
  await fireEvent.changeText(
    screen.getByLabelText("Preview QA password"),
    "fixture-password",
  );
  await fireEvent.press(
    screen.getByRole("button", { name: "Sign in as Preview QA User" }),
  );

  expect(
    await screen.findByRole("header", {
      name: "This Preview QA sign-in is not linked yet",
    }),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole("button", { name: "Link to an existing User" }),
  ).not.toBeOnTheScreen();
  expect(auth.createUser).not.toHaveBeenCalled();

  await fireEvent.press(
    screen.getByRole("button", { name: "Create a new OpenJob User" }),
  );
  expect(await screen.findByText("Signed in as walker")).toBeOnTheScreen();
  expect(auth.createUser).toHaveBeenCalledTimes(1);
});

test("restores an interrupted unknown credential without another provider prompt", async () => {
  const auth = controller({
    restore: jest.fn(async () => ({
      kind: "unrecognized" as const,
      provider: "apple" as const,
    })),
  });

  await renderGate(auth);

  expect(
    await screen.findByRole("header", {
      name: "This Apple sign-in is not linked yet",
    }),
  ).toBeOnTheScreen();
  expect(auth.signIn).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", {
      name: "Create a new OpenJob User",
    }),
  ).toBeOnTheScreen();
});

test("requires fresh existing authentication and confirmation before linking", async () => {
  const confirmation: AuthFlowResult = {
    existingProvider: "apple",
    kind: "confirm-link",
    newProvider: "google",
    user,
  };
  const auth = controller({
    authenticateExistingUser: jest.fn(async () => confirmation),
    signIn: jest.fn(async () => ({
      kind: "unrecognized" as const,
      provider: "google" as const,
    })),
  });
  await renderGate(auth);

  await fireEvent.press(
    await screen.findByRole("button", { name: "Continue with Google" }),
  );
  await fireEvent.press(
    await screen.findByRole("button", {
      name: "Link to an existing User",
    }),
  );
  expect(
    await screen.findByRole("header", { name: "Link Google to @walker?" }),
  ).toBeOnTheScreen();
  expect(auth.confirmLink).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Confirm link" }),
  ).toHaveProp(
    "accessibilityHint",
    expect.stringContaining("@walker's User ID"),
  );

  await fireEvent.press(
    screen.getByRole("button", { name: "Confirm link" }),
  );
  expect(await screen.findByText("Signed in as walker")).toBeOnTheScreen();
  expect(auth.confirmLink).toHaveBeenCalledTimes(1);
});

test.each([
  {
    expectedHeading: "Link Apple to @walker?",
    target: user,
  },
  {
    expectedHeading: "Link Apple to usr_target_shell?",
    target: {
      userId: "usr_target_shell",
      username: null,
      usernameRequired: true,
    },
  },
])("confirms and renders the explicitly proved empty-shell target", async ({
  expectedHeading,
  target,
}) => {
  const targetResult: SignedInResult = {
    kind: "signed-in",
    methods: ["apple", "google"],
    user: target,
  };
  const auth = controller({
    authenticateNewMethod: jest.fn(async () => ({
      existingProvider: "google" as const,
      kind: "confirm-link" as const,
      newProvider: "apple" as const,
      user: target,
    })),
    cancelPending: jest.fn(async () => targetResult),
    confirmLink: jest.fn(async () => targetResult),
    restore: jest.fn(async () => ({
      kind: "signed-in" as const,
      methods: ["google" as const],
      user: {
        userId: "usr_current_shell",
        username: null,
        usernameRequired: true,
      },
    })),
  });
  await renderGate(auth);

  await fireEvent.press(
    await screen.findByRole("button", { name: "Manage Sign-in Methods" }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Link Apple" }));
  expect(
    await screen.findByRole("header", { name: expectedHeading }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Confirm link" }));
  await fireEvent.press(
    await screen.findByRole("button", { name: "Back to OpenJob" }),
  );
  expect(
    await screen.findByText(
      `Signed in as ${target.username ?? target.userId}`,
    ),
  ).toBeOnTheScreen();
});

test("uses Back to discard a failed candidate proof before returning", async () => {
  const auth = controller({
    authenticateNewMethod: jest.fn(async () => {
      throw new OpenJobApiError(503, "service_unavailable");
    }),
    cancelPending: jest.fn(async () => signedIn),
    restore: jest.fn(async () => signedIn),
  });
  await renderGate(auth);

  await fireEvent.press(
    await screen.findByRole("button", { name: "Manage Sign-in Methods" }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Link Apple" }));
  expect(
    await screen.findByText("service_unavailable"),
  ).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "Back to OpenJob" }),
  );

  expect(auth.cancelPending).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Signed in as walker")).toBeOnTheScreen();
});

test("keeps an offline restored credential recoverable and retries without a loop", async () => {
  const auth = controller({
    restore: jest
      .fn()
      .mockResolvedValueOnce({ kind: "restore-retry", reason: "offline" })
      .mockResolvedValueOnce(signedIn),
  });
  await renderGate(auth);

  expect(
    await screen.findByText(
      "OpenJob is offline. Your protected sign-in is still on this device.",
    ),
  ).toBeOnTheScreen();
  expect(auth.restore).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByRole("button", { name: "Retry sign-in" }));
  expect(await screen.findByText("Signed in as walker")).toBeOnTheScreen();
  expect(auth.restore).toHaveBeenCalledTimes(2);
});

test("offers retry when a provider or service cannot restore a saved credential", async () => {
  const auth = controller({
    restore: jest
      .fn()
      .mockResolvedValueOnce({
        kind: "restore-retry",
        reason: "unavailable",
      })
      .mockResolvedValueOnce(signedIn),
  });
  await renderGate(auth);

  expect(
    await screen.findByText(
      "OpenJob could not restore your protected sign-in. Nothing was removed.",
    ),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Retry sign-in" }));
  expect(await screen.findByText("Signed in as walker")).toBeOnTheScreen();
});

test("blocks another sign-in until failed local cleanup is retried", async () => {
  const auth = controller({
    restore: jest.fn(async () => signedIn),
    signOut: jest
      .fn()
      .mockResolvedValueOnce({ kind: "cleanup-retry" })
      .mockResolvedValueOnce({ kind: "signed-out" }),
  });
  await renderGate(auth);

  await fireEvent.press(
    await screen.findByRole("button", { name: "Sign out" }),
  );
  expect(
    await screen.findByText(
      "OpenJob could not finish removing saved data. Retry before signing in again.",
    ),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole("button", { name: "Continue with Google" }),
  ).not.toBeOnTheScreen();

  await fireEvent.press(
    screen.getByRole("button", { name: "Retry cleanup" }),
  );
  expect(
    await screen.findByRole("button", { name: "Continue with Google" }),
  ).toBeOnTheScreen();
});

test("manages the missing provider and exposes sign-out and switch-user cleanup", async () => {
  const confirmation: AuthFlowResult = {
    existingProvider: "google",
    kind: "confirm-link",
    newProvider: "apple",
    user,
  };
  const auth = controller({
    authenticateNewMethod: jest.fn(async () => confirmation),
    cancelPending: jest.fn(async () => signedIn),
    restore: jest.fn(async () => signedIn),
  });
  await renderGate(auth);

  await fireEvent.press(
    await screen.findByRole("button", { name: "Manage Sign-in Methods" }),
  );
  expect(
    await screen.findByRole("header", { name: "Sign-in Methods" }),
  ).toBeOnTheScreen();
  expect(screen.getByText("Google — Linked")).toBeOnTheScreen();
  const linkApple = screen.getByRole("button", { name: "Link Apple" });
  expect(linkApple).toHaveStyle({ minHeight: 48 });
  await fireEvent.press(linkApple);
  expect(
    await screen.findByRole("header", { name: "Link Apple to @walker?" }),
  ).toBeOnTheScreen();

  await fireEvent.press(
    screen.getByRole("button", { name: "Cancel link" }),
  );
  expect(
    await screen.findByRole("header", { name: "Sign-in Methods" }),
  ).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Back to OpenJob" }));
  await fireEvent.press(screen.getByRole("button", { name: "Switch User" }));
  await waitFor(() => expect(auth.switchUser).toHaveBeenCalledTimes(1));
  expect(
    await screen.findByRole("button", { name: "Continue with Apple" }),
  ).toBeOnTheScreen();
});

test("returns an expired current-User proof to a usable reauthentication action", async () => {
  const confirmation: AuthFlowResult = {
    existingProvider: "google",
    kind: "confirm-link",
    newProvider: "apple",
    user,
  };
  const auth = controller({
    authenticateNewMethod: jest.fn(async () => confirmation),
    confirmLink: jest.fn(async () => ({
      ...signedIn,
      notice: "fresh_authentication_required" as const,
    })),
    restore: jest.fn(async () => signedIn),
  });
  await renderGate(auth);

  await fireEvent.press(
    await screen.findByRole("button", { name: "Manage Sign-in Methods" }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Link Apple" }));
  await fireEvent.press(screen.getByRole("button", { name: "Confirm link" }));

  expect(
    await screen.findByText(
      "The second sign-in expired. Authenticate it again.",
    ),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Link Apple" }));
  expect(auth.authenticateNewMethod).toHaveBeenCalledTimes(2);
});

test("returns an unknown-first expired proof to existing-User authentication", async () => {
  const unrecognized: AuthFlowResult = {
    kind: "unrecognized",
    provider: "google",
  };
  const confirmation: AuthFlowResult = {
    existingProvider: "apple",
    kind: "confirm-link",
    newProvider: "google",
    user,
  };
  const auth = controller({
    authenticateExistingUser: jest.fn(async () => confirmation),
    confirmLink: jest.fn(async () => ({
      ...unrecognized,
      notice: "fresh_authentication_required" as const,
    })),
    restore: jest.fn(async () => unrecognized),
  });
  await renderGate(auth);

  await fireEvent.press(
    await screen.findByRole("button", {
      name: "Link to an existing User",
    }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Confirm link" }));

  expect(
    await screen.findByText(
      "The second sign-in expired. Authenticate it again.",
    ),
  ).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "Link to an existing User" }),
  );
  expect(auth.authenticateExistingUser).toHaveBeenCalledTimes(2);
});

test("returns an unknown-first changed target to existing-User authentication", async () => {
  const unrecognized: AuthFlowResult = {
    kind: "unrecognized",
    provider: "google",
  };
  const confirmation: AuthFlowResult = {
    existingProvider: "apple",
    kind: "confirm-link",
    newProvider: "google",
    user,
  };
  const auth = controller({
    authenticateExistingUser: jest.fn(async () => confirmation),
    confirmLink: jest.fn(async () => ({
      ...unrecognized,
      notice: "link_target_changed" as const,
    })),
    restore: jest.fn(async () => unrecognized),
  });
  await renderGate(auth);

  await fireEvent.press(
    await screen.findByRole("button", {
      name: "Link to an existing User",
    }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Confirm link" }));

  expect(
    await screen.findByText(
      "That User changed. Authenticate again and confirm the current User.",
    ),
  ).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "Link to an existing User" }),
  );
  expect(auth.authenticateExistingUser).toHaveBeenCalledTimes(2);
});

test("keeps Sign-in Method status and errors legible in dark appearance", async () => {
  const auth = controller({
    restore: jest.fn(async () => signedIn),
  });
  await renderGate(auth, "dark");

  await fireEvent.press(
    await screen.findByRole("button", { name: "Manage Sign-in Methods" }),
  );
  expect(await screen.findByText("Google — Linked")).toHaveStyle({
    color: "#f4f5ef",
  });
});
