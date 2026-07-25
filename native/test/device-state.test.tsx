/* eslint-disable import/first */
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AppState, DeviceEventEmitter } from "react-native";

const mockGetNetworkStateAsync = jest.fn();
const mockAddNetworkStateListener = jest.fn();

jest.mock("expo-network", () => ({
  addNetworkStateListener: (...args: unknown[]) =>
    mockAddNetworkStateListener(...args),
  getNetworkStateAsync: (...args: unknown[]) =>
    mockGetNetworkStateAsync(...args),
}));

import { useDeviceRecoverySignals } from "../src/device-state";

type NetworkListener = (state: {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}) => void;

beforeEach(() => {
  jest.restoreAllMocks();
  mockAddNetworkStateListener.mockReset();
  mockGetNetworkStateAsync.mockReset();
});

test("signals only real offline-to-online connectivity restoration", async () => {
  let networkListener: NetworkListener | undefined;
  const remove = jest.fn();
  mockGetNetworkStateAsync.mockResolvedValue({
    isConnected: false,
    isInternetReachable: false,
  });
  mockAddNetworkStateListener.mockImplementation(
    (listener: NetworkListener) => {
      networkListener = listener;
      return { remove };
    },
  );
  jest.spyOn(AppState, "addEventListener").mockReturnValue({
    remove: jest.fn(),
  });

  const rendered = await renderHook(() => useDeviceRecoverySignals());
  await waitFor(() => expect(mockGetNetworkStateAsync).toHaveBeenCalledTimes(1));

  expect(rendered.result.current.connectivityRestored).toBe(0);
  await act(() =>
    networkListener?.({ isConnected: false, isInternetReachable: false }),
  );
  expect(rendered.result.current.connectivityRestored).toBe(0);
  await act(() =>
    networkListener?.({ isConnected: true, isInternetReachable: true }),
  );
  expect(rendered.result.current.connectivityRestored).toBe(1);
  await act(() =>
    networkListener?.({ isConnected: true, isInternetReachable: true }),
  );
  expect(rendered.result.current.connectivityRestored).toBe(1);
  await act(() =>
    networkListener?.({ isConnected: false, isInternetReachable: false }),
  );
  await act(() =>
    networkListener?.({ isConnected: true, isInternetReachable: true }),
  );
  expect(rendered.result.current.connectivityRestored).toBe(2);

  await rendered.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test("ignores unavailable connectivity inspection and exposes memory warnings", async () => {
  let memoryWarning: (() => void) | undefined;
  let androidMemoryWarning: (() => void) | undefined;
  const removeMemoryWarning = jest.fn();
  const removeAndroidMemoryWarning = jest.fn();
  mockGetNetworkStateAsync.mockRejectedValue(new Error("network unavailable"));
  mockAddNetworkStateListener.mockReturnValue({ remove: jest.fn() });
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((event, listener) => {
      if (event === "memoryWarning") {
        memoryWarning = listener as unknown as () => void;
        return { remove: removeMemoryWarning };
      }
      return { remove: jest.fn() };
    });
  jest
    .spyOn(DeviceEventEmitter, "addListener")
    .mockImplementation((_event, listener) => {
      androidMemoryWarning = listener as () => void;
      return { remove: removeAndroidMemoryWarning } as never;
    });

  const onMemoryWarning = jest.fn();
  const rendered = await renderHook(() =>
    useDeviceRecoverySignals(onMemoryWarning),
  );
  await act(async () => {
    await Promise.resolve();
  });

  expect(rendered.result.current.connectivityRestored).toBe(0);
  await act(() => memoryWarning?.());
  expect(onMemoryWarning).toHaveBeenCalledTimes(1);
  await act(() => androidMemoryWarning?.());
  expect(onMemoryWarning).toHaveBeenCalledTimes(2);

  await rendered.unmount();
  expect(removeMemoryWarning).toHaveBeenCalledTimes(1);
  expect(removeAndroidMemoryWarning).toHaveBeenCalledTimes(1);
});
