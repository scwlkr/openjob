/* eslint-disable import/first */
import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { AppState } from "react-native";

const mockGetNetworkStateAsync = jest.fn();
const mockAddNetworkStateListener = jest.fn();

jest.mock("expo-network", () => ({
  addNetworkStateListener: (...args: unknown[]) =>
    mockAddNetworkStateListener(...args),
  getNetworkStateAsync: (...args: unknown[]) =>
    mockGetNetworkStateAsync(...args),
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useIsFocused: () => true,
}));

import { ReadOnlyTaskList } from "../src/ReadOnlyTaskList";
import { ProviderSignInError } from "../src/auth/coordinator";
import type {
  NativeCachedTaskList,
  NativeGroup,
  NativeTask,
  NativeTaskListController,
  NativeTaskListSnapshot,
} from "../src/task-list-contracts";
import { OpenJobThemeProvider } from "../src/theme";

type NetworkListener = (state: {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}) => void;

const group: NativeGroup = {
  createdAt: "2026-07-25T12:00:00.000Z",
  groupId: "grp_lifecycle",
  name: "Lifecycle Group",
  role: "admin",
};

function task(taskId: string, text: string): NativeTask {
  return {
    assignee: {
      state: "assigned",
      userId: "usr_owner",
      username: "walker",
    },
    completedAt: null,
    createdAt: "2026-07-25T12:00:00.000Z",
    dueDate: null,
    groupId: group.groupId,
    priority: "normal",
    state: "open",
    taskId,
    text,
  };
}

function snapshot(tasks: NativeTask[]): NativeTaskListSnapshot {
  return {
    members: [
      {
        joinedAt: "2026-07-25T12:00:00.000Z",
        role: "admin",
        userId: "usr_owner",
        username: "walker",
      },
    ],
    tasks,
  };
}

function cached(tasks: NativeTask[]): NativeCachedTaskList {
  return {
    freshAt: "2026-07-25T12:00:00.000Z",
    group,
    snapshot: snapshot(tasks),
    status: "open",
    validator: '"cached"',
  };
}

function controller(
  entry: NativeCachedTaskList,
  syncTaskList: NativeTaskListController["syncTaskList"],
): NativeTaskListController {
  return {
    listGroups: jest.fn(async () => [group]),
    loadCachedTaskList: jest.fn(async () => entry),
    purgeCachedTaskList: jest.fn(async () => undefined),
    readTaskList: jest.fn(async () => entry.snapshot),
    saveCachedTaskList: jest.fn(async () => undefined),
    syncTaskList,
  };
}

async function renderTaskList(taskListController: NativeTaskListController) {
  return render(
    <OpenJobThemeProvider preference="light" setPreference={jest.fn()}>
      <ReadOnlyTaskList
        controller={taskListController}
        onRestoreSession={jest.fn()}
        onSessionRevoked={jest.fn()}
        ownerUserId="usr_owner"
        reducedMotion={false}
        sessionReady
      />
    </OpenJobThemeProvider>,
  );
}

beforeEach(() => {
  jest.restoreAllMocks();
  mockAddNetworkStateListener.mockReset();
  mockGetNetworkStateAsync.mockReset();
  AppState.currentState = "active";
});

test("retries the visible stale Task List immediately when connectivity returns", async () => {
  let networkListener: NetworkListener | undefined;
  mockGetNetworkStateAsync.mockResolvedValue({
    isConnected: false,
    isInternetReachable: false,
  });
  mockAddNetworkStateListener.mockImplementation(
    (listener: NetworkListener) => {
      networkListener = listener;
      return { remove: jest.fn() };
    },
  );
  jest.spyOn(AppState, "addEventListener").mockReturnValue({
    remove: jest.fn(),
  });
  const syncTaskList = jest
    .fn<ReturnType<NativeTaskListController["syncTaskList"]>, Parameters<NativeTaskListController["syncTaskList"]>>()
    .mockRejectedValueOnce(new ProviderSignInError("offline"))
    .mockResolvedValueOnce({
      freshAt: "2026-07-25T12:01:00.000Z",
      kind: "not-modified",
      validator: '"cached"',
    });
  const taskListController = controller(
    cached([task("task_one", "Offline reference")]),
    syncTaskList,
  );
  const rendered = await renderTaskList(taskListController);

  expect(
    await screen.findByText(/Offline · Read-only · Last updated/u),
  ).toBeOnTheScreen();
  expect(syncTaskList).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(mockGetNetworkStateAsync).toHaveBeenCalledTimes(1));

  await act(() =>
    networkListener?.({ isConnected: true, isInternetReachable: true }),
  );

  await waitFor(() => expect(syncTaskList).toHaveBeenCalledTimes(2));
  expect(
    screen.queryByText(/Offline · Read-only · Last updated/u),
  ).not.toBeOnTheScreen();
  expect(screen.getByText(/Fresh · Last checked/u)).toBeOnTheScreen();

  await rendered.unmount();
});

test("releases transient rows on memory pressure without losing the usable list", async () => {
  let memoryWarning: (() => void) | undefined;
  mockGetNetworkStateAsync.mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  });
  mockAddNetworkStateListener.mockReturnValue({ remove: jest.fn() });
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((event, listener) => {
      if (event === "memoryWarning") {
        memoryWarning = listener as unknown as () => void;
      }
      return { remove: jest.fn() };
    });
  let finishSync:
    | ((result: Awaited<ReturnType<NativeTaskListController["syncTaskList"]>>) => void)
    | undefined;
  const syncTaskList = jest.fn(
    () =>
      new Promise<Awaited<ReturnType<NativeTaskListController["syncTaskList"]>>>(
        (resolve) => {
          finishSync = resolve;
        },
      ),
  );
  const kept = task("task_kept", "Keep visible");
  const released = task("task_released", "Release transient row");
  const taskListController = controller(cached([kept, released]), syncTaskList);
  const rendered = await renderTaskList(taskListController);

  expect(await screen.findByText("Keep visible")).toBeOnTheScreen();
  expect(screen.getByText("Release transient row")).toBeOnTheScreen();
  await waitFor(() => expect(syncTaskList).toHaveBeenCalledTimes(1));

  await act(() => {
    finishSync?.({
      freshAt: "2026-07-25T12:01:00.000Z",
      kind: "changed",
      snapshot: snapshot([kept]),
      validator: '"changed"',
    });
  });
  expect(screen.getByText("Release transient row")).toBeOnTheScreen();

  await act(() => memoryWarning?.());

  expect(screen.getByText("Keep visible")).toBeOnTheScreen();
  expect(screen.queryByText("Release transient row")).not.toBeOnTheScreen();
  expect(syncTaskList).toHaveBeenCalledTimes(1);

  await rendered.unmount();
});
