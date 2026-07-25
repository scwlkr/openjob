import {
  AccessibilityInfo,
  AppState,
  DeviceEventEmitter,
  type AppStateStatus,
} from "react-native";
import {
  addNetworkStateListener,
  getNetworkStateAsync,
  type NetworkState,
} from "expo-network";
import { useEffect, useRef, useState } from "react";

function internetReachability(state: NetworkState): boolean | null {
  if (typeof state.isInternetReachable === "boolean") {
    return state.isInternetReachable;
  }
  if (typeof state.isConnected === "boolean") return state.isConnected;
  return null;
}

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

export function useAppLifecycle(): AppStateStatus {
  const [state, setState] = useState<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setState);
    return () => subscription.remove();
  }, []);

  return state;
}

export function useDeviceRecoverySignals(
  onMemoryWarning?: () => void,
): {
  connectivityRestored: number;
} {
  const [connectivityRestored, setConnectivityRestored] = useState(0);
  const reachable = useRef<boolean | null>(null);
  const memoryWarningHandler = useRef(onMemoryWarning);

  useEffect(() => {
    memoryWarningHandler.current = onMemoryWarning;
  }, [onMemoryWarning]);

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const update = (state: NetworkState) => {
      const next = internetReachability(state);
      if (next === null) return;
      const previous = reachable.current;
      reachable.current = next;
      if (previous === false && next) {
        setConnectivityRestored((current) => current + 1);
      }
    };
    const subscription = addNetworkStateListener((state) => {
      receivedEvent = true;
      if (active) update(state);
    });
    void getNetworkStateAsync().then(
      (state) => {
        if (active && !receivedEvent) update(state);
      },
      () => undefined,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const notify = () => {
      memoryWarningHandler.current?.();
    };
    const iosSubscription = AppState.addEventListener("memoryWarning", notify);
    const androidSubscription = DeviceEventEmitter.addListener(
      "openjobMemoryPressure",
      notify,
    );
    return () => {
      iosSubscription.remove();
      androidSubscription.remove();
    };
  }, []);

  return { connectivityRestored };
}
