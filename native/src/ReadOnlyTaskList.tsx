import { Feather } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  K,
  type KeyboardFocus,
  type OnKeyPress,
} from "react-native-external-keyboard";
import {
  type AppearanceKeyboardAction,
  resolveAppearanceKey,
} from "./appearance-keyboard";
import {
  OpenJobApiError,
  ProviderSignInError,
} from "./auth/coordinator";
import { OpenJobBrandmark } from "./brand-marks";
import { useAppLifecycle } from "./device-state";
import type {
  NativeCachedTaskList,
  NativeGroup,
  NativeTask,
  NativeTaskListController,
  NativeTaskListSnapshot,
  NativeTaskListSyncResult,
  NativeTaskStatus,
} from "./task-list-contracts";
import {
  nextPollDelayMs,
  reconcileTaskListSnapshot,
  retainRemovedTasksForExit,
} from "./task-list-freshness";
import { useOpenJobTheme } from "./theme";
import { useControlInteraction } from "./use-control-interaction";

type TaskStatus = NativeTaskStatus;
const taskStatuses: TaskStatus[] = ["open", "done", "all"];

type TaskSection = {
  data: NativeTask[];
  key: string;
  label: string;
  screenReaderLabel: string;
};

const emptySnapshot: NativeTaskListSnapshot = { members: [], tasks: [] };

function GroupButton({
  focusRef,
  group,
  onKeyboardAction,
  onPress,
  selected,
}: {
  focusRef: (instance: KeyboardFocus | null) => void;
  group: NativeGroup;
  onKeyboardAction: (action: AppearanceKeyboardAction) => void;
  onPress: () => void;
  selected: boolean;
}) {
  const { palette } = useOpenJobTheme();
  const { focused, hovered, interactionProps } = useControlInteraction();
  return (
    <K.Pressable
      accessibilityLabel={`Open ${group.name}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onKeyDownPress={(event: OnKeyPress) => {
        const action = resolveAppearanceKey(
          Platform.OS,
          event.nativeEvent.keyCode,
        );
        if (action) onKeyboardAction(action);
      }}
      onPress={onPress}
      ref={focusRef}
      {...interactionProps}
      style={({ pressed }) => [
        styles.groupButton,
        {
          backgroundColor: selected
            ? palette.blue
            : pressed || hovered
              ? palette.card
              : palette.paper,
          borderColor:
            focused || hovered || selected ? palette.blue : palette.line,
          borderWidth: focused ? 3 : 1,
        },
      ]}
    >
      <View style={styles.groupButtonCopy}>
        <Text
          style={[
            styles.groupButtonName,
            { color: selected ? palette.onBlue : palette.ink },
          ]}
        >
          {group.name}
        </Text>
        <Text
          style={[
            styles.groupButtonRole,
            { color: selected ? palette.onBlue : palette.muted },
          ]}
        >
          {group.role === "admin" ? "Admin" : "Member"}
        </Text>
      </View>
      <Feather
        color={selected ? palette.onBlue : palette.blue}
        name="chevron-right"
        size={20}
      />
    </K.Pressable>
  );
}

function GroupControls({
  groups,
  onEscape,
  onSelect,
  selectedGroupId,
}: {
  groups: NativeGroup[];
  onEscape?: () => void;
  onSelect: (group: NativeGroup) => void;
  selectedGroupId: string | null;
}) {
  const groupRefs = useRef<(KeyboardFocus | null)[]>([]);
  const handleKeyboardAction = (
    index: number,
    action: AppearanceKeyboardAction,
  ) => {
    if (action === "escape") {
      onEscape?.();
      return;
    }
    const direction = action === "next" ? 1 : -1;
    const nextIndex =
      (index + direction + groups.length) % groups.length;
    groupRefs.current[nextIndex]?.keyboardFocus();
  };

  return groups.map((group, index) => (
    <GroupButton
      focusRef={(instance) => {
        groupRefs.current[index] = instance;
      }}
      group={group}
      key={group.groupId}
      onKeyboardAction={(action) => handleKeyboardAction(index, action)}
      onPress={() => onSelect(group)}
      selected={group.groupId === selectedGroupId}
    />
  ));
}

function ActionButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const { palette } = useOpenJobTheme();
  const { focused, hovered, interactionProps } = useControlInteraction();
  return (
    <K.Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      {...interactionProps}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor:
            pressed || hovered ? palette.blueStrong : palette.blue,
          borderColor: focused ? palette.ink : palette.blue,
          borderWidth: focused ? 3 : 1,
        },
      ]}
    >
      <Text style={[styles.actionButtonText, { color: palette.onBlue }]}>
        {label}
      </Text>
    </K.Pressable>
  );
}

function GroupChooser({
  groups,
  loading,
  message,
  onEscape,
  onRetry,
  onSelect,
}: {
  groups: NativeGroup[];
  loading: boolean;
  message: string | null;
  onEscape?: () => void;
  onRetry: () => void;
  onSelect: (group: NativeGroup) => void;
}) {
  const { isDark, palette } = useOpenJobTheme();
  return (
    <ScrollView
      contentContainerStyle={styles.chooserContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.chooserHeader}>
        <View style={styles.chooserBrandmark}>
          <OpenJobBrandmark inverse={isDark} />
        </View>
        <Text style={[styles.kicker, { color: palette.blue }]}>
          SHARED TASK LIST
        </Text>
        <Text
          accessibilityRole="header"
          style={[styles.chooserTitle, { color: palette.ink }]}
        >
          Choose a Group
        </Text>
        <Text style={[styles.chooserLede, { color: palette.muted }]}>
          Select one accessible Group to open its Task List.
        </Text>
        {message ? (
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            style={[
              styles.notice,
              { backgroundColor: palette.card, borderColor: palette.blue },
            ]}
          >
            <Text style={[styles.noticeText, { color: palette.ink }]}>
              {message}
            </Text>
            <ActionButton label="Retry Groups" onPress={onRetry} />
          </View>
        ) : null}
      </View>
      {loading ? (
        <View
          accessibilityLabel="Loading Groups"
          accessibilityRole="progressbar"
          style={styles.centeredState}
        >
          <ActivityIndicator color={palette.blue} size="large" />
          <Text style={[styles.stateTitle, { color: palette.ink }]}>
            Loading Groups…
          </Text>
        </View>
      ) : groups.length > 0 ? (
        <View style={styles.groupChoices}>
          <GroupControls
            groups={groups}
            onEscape={onEscape}
            onSelect={onSelect}
            selectedGroupId={null}
          />
        </View>
      ) : message ? null : (
        <View style={styles.centeredState}>
          <Text style={[styles.stateTitle, { color: palette.ink }]}>
            No Groups yet
          </Text>
          <Text style={[styles.stateMessage, { color: palette.muted }]}>
            Join or create a Group on the web, then retry here.
          </Text>
          <ActionButton label="Retry Groups" onPress={onRetry} />
        </View>
      )}
    </ScrollView>
  );
}

function FilterTab({
  count,
  focusRef,
  onKeyboardAction,
  onPress,
  selected,
  status,
}: {
  count: number;
  focusRef: (instance: KeyboardFocus | null) => void;
  onKeyboardAction: (action: AppearanceKeyboardAction) => void;
  onPress: () => void;
  selected: boolean;
  status: TaskStatus;
}) {
  const { palette } = useOpenJobTheme();
  const { focused, hovered, interactionProps } = useControlInteraction();
  const name = `${status[0]!.toUpperCase()}${status.slice(1)}`;
  return (
    <K.Pressable
      accessibilityLabel={`${name} ${count}`}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      focusable={selected}
      onKeyDownPress={(event: OnKeyPress) => {
        const action = resolveAppearanceKey(
          Platform.OS,
          event.nativeEvent.keyCode,
        );
        if (action) onKeyboardAction(action);
      }}
      onPress={onPress}
      ref={focusRef}
      {...interactionProps}
      style={({ pressed }) => [
        styles.filterTab,
        {
          backgroundColor: selected
            ? palette.blue
            : pressed || hovered
              ? palette.card
              : palette.paper,
          borderColor:
            focused || hovered || selected ? palette.blue : palette.line,
          borderWidth: focused ? 3 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.filterLabel,
          { color: selected ? palette.onBlue : palette.ink },
        ]}
      >
        {name}
      </Text>
      <Text
        style={[
          styles.filterCount,
          { color: selected ? palette.onBlue : palette.muted },
        ]}
      >
        {count}
      </Text>
    </K.Pressable>
  );
}

function dueDescription(task: NativeTask, now = new Date()) {
  if (!task.dueDate) return null;
  const [yearText, monthText, dayText] = task.dueDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const monthName = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][month - 1];
  const display =
    year === now.getFullYear()
      ? `${monthName} ${day}`
      : `${monthName} ${day}, ${year}`;
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return {
    display,
    overdue: task.state === "open" && task.dueDate < today,
  };
}

function taskAccessibilityLabel(task: NativeTask) {
  const assignee =
    task.assignee.state === "assigned"
      ? `Assigned to @${task.assignee.username}.`
      : "Unassigned.";
  const due = dueDescription(task);
  const dueLabel = due
    ? `${due.overdue ? "Overdue, due" : "Due"} ${due.display}.`
    : "";
  return [
    `${task.state === "open" ? "Open" : "Done"} Task.`,
    `${task.text}.`,
    assignee,
    `${task.priority[0]!.toUpperCase()}${task.priority.slice(1)} priority.`,
    dueLabel,
  ]
    .filter(Boolean)
    .join(" ");
}

const TaskRow = memo(function TaskRow({
  animate,
  reducedMotion,
  removing,
  task,
}: {
  animate: boolean;
  reducedMotion: boolean;
  removing: boolean;
  task: NativeTask;
}) {
  const { palette } = useOpenJobTheme();
  const due = dueDescription(task);
  const [progress] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!animate || reducedMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(removing ? 1 : 0);
    const animation = Animated.timing(progress, {
      duration: 180,
      toValue: removing ? 0 : 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, progress, reducedMotion, removing, task]);
  return (
    <Animated.View
      accessible
      accessibilityLabel={taskAccessibilityLabel(task)}
      style={[
        styles.taskRow,
        { backgroundColor: palette.paper, borderColor: palette.line },
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        },
      ]}
      testID={`openjob-row-${task.taskId}${animate ? "-affected" : ""}`}
    >
      <View style={styles.taskCopy}>
        <Text style={[styles.taskText, { color: palette.ink }]}>
          {task.text}
        </Text>
        <View style={styles.taskMetadata}>
          <Text style={[styles.taskMetaText, { color: palette.muted }]}>
            {task.assignee.state === "assigned"
              ? `@${task.assignee.username}`
              : "Unassigned"}
          </Text>
          {due ? (
            <Text
              style={[
                styles.taskMetaText,
                { color: due.overdue ? palette.blueStrong : palette.muted },
              ]}
            >
              {due.overdue ? `Overdue · ${due.display}` : `Due ${due.display}`}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.taskBadges}>
        {task.priority === "normal" ? null : (
          <View
            style={[
              styles.taskBadge,
              { backgroundColor: palette.card, borderColor: palette.line },
            ]}
          >
            <Text style={[styles.taskBadgeText, { color: palette.ink }]}>
              {task.priority[0]!.toUpperCase()}
              {task.priority.slice(1)}
            </Text>
          </View>
        )}
        <View
          style={[
            styles.taskBadge,
            { backgroundColor: palette.card, borderColor: palette.line },
          ]}
        >
          <Text style={[styles.taskBadgeText, { color: palette.ink }]}>
            {task.state === "open" ? "Open" : "Done"}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
});

function sectionsFor(
  snapshot: NativeTaskListSnapshot,
  status: TaskStatus,
): TaskSection[] {
  const currentUsernames = new Set(
    snapshot.members.flatMap((member) =>
      member.username ? [member.username] : [],
    ),
  );
  const sections = new Map<string, TaskSection>();
  for (const task of snapshot.tasks) {
    if (status !== "all" && task.state !== status) continue;
    const username =
      task.assignee.state === "assigned"
        ? task.assignee.username
        : null;
    const key = username ? `assigned:${username}` : "unassigned";
    let section = sections.get(key);
    if (!section) {
      const former = username !== null && !currentUsernames.has(username);
      section = {
        data: [],
        key,
        label: username
          ? former
            ? `Former Member · @${username}`
            : `@${username}`
          : "Unassigned",
        screenReaderLabel: username
          ? former
            ? `Former Member, @${username}`
            : `@${username}`
          : "Unassigned",
      };
      sections.set(key, section);
    }
    section.data.push(task);
  }
  return [...sections.values()];
}

function TaskListHeader({
  freshnessMessage,
  group,
  onRetry,
  onShowChooser,
  retryMessage,
  snapshot,
  status,
  wide,
  setStatus,
}: {
  freshnessMessage: string | null;
  group: NativeGroup;
  onRetry: () => void;
  onShowChooser: () => void;
  retryMessage: string | null;
  snapshot: NativeTaskListSnapshot;
  status: TaskStatus;
  wide: boolean;
  setStatus: (status: TaskStatus) => void;
}) {
  const { palette } = useOpenJobTheme();
  const filterRefs = useRef<Record<TaskStatus, KeyboardFocus | null>>({
    all: null,
    done: null,
    open: null,
  });
  const pendingKeyboardFocus = useRef<TaskStatus | null>(null);
  const {
    focused: switcherFocused,
    hovered: switcherHovered,
    interactionProps: switcherInteractionProps,
  } = useControlInteraction();
  const counts = useMemo(() => {
    const open = snapshot.tasks.filter((task) => task.state === "open").length;
    return {
      all: snapshot.tasks.length,
      done: snapshot.tasks.length - open,
      open,
    };
  }, [snapshot.tasks]);
  useEffect(() => {
    if (pendingKeyboardFocus.current !== status) return;
    const frame = requestAnimationFrame(() => {
      filterRefs.current[status]?.keyboardFocus();
      pendingKeyboardFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [status]);
  const handleFilterKeyboardAction = (
    current: TaskStatus,
    action: AppearanceKeyboardAction,
  ) => {
    if (action === "escape") {
      onShowChooser();
      return;
    }
    const direction = action === "next" ? 1 : -1;
    const currentIndex = taskStatuses.indexOf(current);
    const nextStatus =
      taskStatuses[
        (currentIndex + direction + taskStatuses.length) %
          taskStatuses.length
      ]!;
    pendingKeyboardFocus.current = nextStatus;
    setStatus(nextStatus);
  };
  return (
    <View style={styles.listHeader}>
      {!wide ? (
        <K.Pressable
          accessibilityLabel={`Switch Group, currently ${group.name}`}
          accessibilityRole="button"
          onPress={onShowChooser}
          {...switcherInteractionProps}
          style={({ pressed }) => [
            styles.narrowSwitcher,
            {
              backgroundColor:
                pressed || switcherHovered ? palette.card : palette.paper,
              borderColor:
                switcherFocused || switcherHovered
                  ? palette.blue
                  : palette.line,
              borderWidth: switcherFocused ? 3 : 1,
            },
          ]}
        >
          <View style={styles.groupButtonCopy}>
            <Text style={[styles.switcherLabel, { color: palette.muted }]}>
              GROUP
            </Text>
            <Text style={[styles.switcherName, { color: palette.ink }]}>
              {group.name}
            </Text>
          </View>
          <Feather color={palette.blue} name="chevron-down" size={21} />
        </K.Pressable>
      ) : null}
      <View style={styles.taskListTitleBlock}>
        <Text style={[styles.kicker, { color: palette.blue }]}>TASK LIST</Text>
        <Text
          accessibilityLabel={`${group.name} Task List`}
          accessibilityRole="header"
          style={[styles.taskListTitle, { color: palette.ink }]}
        >
          {group.name}
        </Text>
      </View>
      <View
        accessibilityLabel="Task state filter"
        accessibilityRole="tablist"
        style={styles.filters}
      >
        {taskStatuses.map((candidate) => (
          <FilterTab
            count={counts[candidate]}
            focusRef={(instance) => {
              filterRefs.current[candidate] = instance;
            }}
            key={candidate}
            onKeyboardAction={(action) =>
              handleFilterKeyboardAction(candidate, action)
            }
            onPress={() => setStatus(candidate)}
            selected={status === candidate}
            status={candidate}
          />
        ))}
      </View>
      {retryMessage ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[
            styles.notice,
            { backgroundColor: palette.card, borderColor: palette.blue },
          ]}
        >
          <Text style={[styles.noticeText, { color: palette.ink }]}>
            {retryMessage}
          </Text>
          <ActionButton label="Retry Task List" onPress={onRetry} />
        </View>
      ) : freshnessMessage ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.freshness, { color: palette.muted }]}
        >
          {freshnessMessage}
        </Text>
      ) : null}
    </View>
  );
}

function errorMessage(error: unknown) {
  if (error instanceof ProviderSignInError && error.code === "offline") {
    return "OpenJob is offline. Check your connection and retry.";
  }
  return "OpenJob could not load this Task List. Retry when you're ready.";
}

function isRevoked(error: unknown) {
  return (
    (error instanceof ProviderSignInError && error.code === "revoked") ||
    (error instanceof OpenJobApiError && error.status === 401)
  );
}

type RefreshOutcome = "changed" | "error" | "ignored" | "not-modified";
type PendingChange = {
  group: NativeGroup;
  result: Extract<NativeTaskListSyncResult, { kind: "changed" }>;
};

function readableTimestamp(value: string | null) {
  if (!value) return "an unknown time";
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toLocaleString() : value;
}

function savedMessage(freshAt: string | null) {
  return `Saved copy · Read-only · Last updated ${readableTimestamp(freshAt)}.`;
}

function staleMessage(freshAt: string | null, error: unknown) {
  const prefix =
    error instanceof ProviderSignInError && error.code === "offline"
      ? "Offline"
      : "Refresh unavailable";
  return `${prefix} · Read-only · Last updated ${readableTimestamp(freshAt)}.`;
}

export function ReadOnlyTaskList({
  controller,
  onRestoreSession,
  onSessionRevoked,
  ownerUserId,
  reducedMotion,
  restoreReason,
  sessionReady,
}: {
  controller: NativeTaskListController;
  onRestoreSession: () => void;
  onSessionRevoked: () => void;
  ownerUserId: string;
  reducedMotion: boolean;
  restoreReason?: "offline" | "unavailable";
  sessionReady: boolean;
}) {
  const { width } = useWindowDimensions();
  const { palette } = useOpenJobTheme();
  const appState = useAppLifecycle();
  const isFocused = useIsFocused();
  const wide = width >= 760;
  const groupGeneration = useRef(0);
  const refreshGeneration = useRef(0);
  const refreshInFlight = useRef<Promise<RefreshOutcome> | null>(null);
  const unchangedCount = useRef(0);
  const gestureActive = useRef(false);
  const momentumActive = useRef(false);
  const pendingChange = useRef<PendingChange | null>(null);
  const changedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedGroupRef = useRef<NativeGroup | null>(null);
  const snapshotRef = useRef<NativeTaskListSnapshot | null>(null);
  const statusRef = useRef<TaskStatus>("open");
  const validatorRef = useRef<string | null>(null);
  const freshAtRef = useRef<string | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [groups, setGroups] = useState<NativeGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupMessage, setGroupMessage] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<NativeGroup | null>(null);
  const [showChooser, setShowChooser] = useState(true);
  const [snapshot, setSnapshot] = useState<NativeTaskListSnapshot | null>(null);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatus>("open");
  const [freshAt, setFreshAt] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<
    "fresh" | "offline" | "saved" | null
  >(null);
  const [refreshing, setRefreshing] = useState(false);
  const [changedTaskIds, setChangedTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [removingTaskIds, setRemovingTaskIds] = useState<Set<string>>(
    () => new Set(),
  );

  const clearSelection = useCallback(() => {
    refreshGeneration.current += 1;
    refreshInFlight.current = null;
    selectedGroupRef.current = null;
    snapshotRef.current = null;
    validatorRef.current = null;
    freshAtRef.current = null;
    pendingChange.current = null;
    if (removalTimer.current) clearTimeout(removalTimer.current);
    removalTimer.current = null;
    setSelectedGroup(null);
    setSnapshot(null);
    setFreshAt(null);
    setFreshness(null);
    setShowChooser(true);
    setTaskMessage(null);
    setRemovingTaskIds(new Set());
  }, []);

  const loadGroups = useCallback(
    async (message: string | null = null) => {
      if (!sessionReady) return;
      const generation = ++groupGeneration.current;
      setGroupsLoading(true);
      setGroupMessage(message);
      try {
        const nextGroups = await controller.listGroups();
        if (generation !== groupGeneration.current) return;
        const current = selectedGroupRef.current;
        if (current) {
          const accessible = nextGroups.find(
            ({ groupId }) => groupId === current.groupId,
          );
          if (!accessible) {
            try {
              await controller.purgeCachedTaskList();
            } catch {
              onSessionRevoked();
              return;
            }
            if (generation !== groupGeneration.current) return;
            clearSelection();
            setGroups(nextGroups);
            setGroupMessage(
              `${current.name} is no longer accessible. Choose another Group.`,
            );
            return;
          }
          selectedGroupRef.current = accessible;
          setSelectedGroup(accessible);
        }
        setGroups(nextGroups);
        setGroupMessage(message);
      } catch (error) {
        if (generation !== groupGeneration.current) return;
        if (isRevoked(error)) {
          onSessionRevoked();
          return;
        }
        if (selectedGroupRef.current && snapshotRef.current) {
          setFreshness("offline");
          setTaskMessage(staleMessage(freshAtRef.current, error));
        } else {
          setGroups([]);
          setGroupMessage(errorMessage(error));
        }
      } finally {
        if (generation === groupGeneration.current) setGroupsLoading(false);
      }
    },
    [clearSelection, controller, onSessionRevoked, sessionReady],
  );

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => controller.loadCachedTaskList())
      .then((cached) => {
        if (!active) return;
        if (cached) {
          selectedGroupRef.current = cached.group;
          snapshotRef.current = cached.snapshot;
          statusRef.current = cached.status;
          validatorRef.current = cached.validator;
          freshAtRef.current = cached.freshAt;
          setGroups([cached.group]);
          setGroupsLoading(false);
          setSelectedGroup(cached.group);
          setShowChooser(false);
          setSnapshot(cached.snapshot);
          setStatus(cached.status);
          setFreshAt(cached.freshAt);
          setFreshness("saved");
          setTaskMessage(savedMessage(cached.freshAt));
        }
        setCacheLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setGroupsLoading(false);
        setCacheLoaded(true);
      });
    return () => {
      active = false;
      groupGeneration.current += 1;
      refreshGeneration.current += 1;
      refreshInFlight.current = null;
      if (changedTimer.current) clearTimeout(changedTimer.current);
      if (removalTimer.current) clearTimeout(removalTimer.current);
    };
  }, [controller, ownerUserId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active && cacheLoaded && sessionReady) void loadGroups();
    });
    return () => {
      active = false;
    };
  }, [cacheLoaded, loadGroups, sessionReady]);

  const applyChanged = useCallback(
    async (
      group: NativeGroup,
      result: Extract<NativeTaskListSyncResult, { kind: "changed" }>,
    ) => {
      const previous = snapshotRef.current;
      const reconciled = previous
        ? reconcileTaskListSnapshot(previous, result.snapshot)
        : {
            changedTaskIds: result.snapshot.tasks.map(({ taskId }) => taskId),
            removedTaskIds: [] as string[],
            snapshot: result.snapshot,
          };
      snapshotRef.current = reconciled.snapshot;
      validatorRef.current = result.validator;
      freshAtRef.current = result.freshAt;
      if (removalTimer.current) clearTimeout(removalTimer.current);
      removalTimer.current = null;
      if (!reducedMotion && previous && reconciled.removedTaskIds.length > 0) {
        setRemovingTaskIds(new Set(reconciled.removedTaskIds));
        setSnapshot(
          retainRemovedTasksForExit(
            previous,
            reconciled.snapshot,
            reconciled.removedTaskIds,
          ),
        );
        removalTimer.current = setTimeout(() => {
          setSnapshot(reconciled.snapshot);
          setRemovingTaskIds(new Set());
          removalTimer.current = null;
        }, 180);
      } else {
        setRemovingTaskIds(new Set());
        setSnapshot(reconciled.snapshot);
      }
      setFreshAt(result.freshAt);
      setFreshness("fresh");
      setTaskMessage(null);
      const affected = new Set([
        ...reconciled.changedTaskIds,
        ...reconciled.removedTaskIds,
      ]);
      setChangedTaskIds(affected);
      if (changedTimer.current) clearTimeout(changedTimer.current);
      changedTimer.current = setTimeout(() => {
        setChangedTaskIds(new Set());
      }, 240);
      const cached: NativeCachedTaskList = {
        freshAt: result.freshAt,
        group,
        snapshot: reconciled.snapshot,
        status: statusRef.current,
        validator: result.validator,
      };
      await controller.saveCachedTaskList(cached).catch(() => undefined);
    },
    [controller, reducedMotion],
  );

  const applyPendingChange = useCallback(() => {
    gestureActive.current = false;
    const pending = pendingChange.current;
    pendingChange.current = null;
    if (pending) void applyChanged(pending.group, pending.result);
  }, [applyChanged]);

  const finishDrag = useCallback(() => {
    requestAnimationFrame(() => {
      if (!momentumActive.current) applyPendingChange();
    });
  }, [applyPendingChange]);

  const runRefresh = useCallback((): Promise<RefreshOutcome> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const group = selectedGroupRef.current;
    if (!sessionReady || !group) return Promise.resolve("error");
    const generation = refreshGeneration.current;
    const operation = (async (): Promise<RefreshOutcome> => {
      try {
        const result = await controller.syncTaskList(
          group.groupId,
          validatorRef.current,
        );
        if (
          generation !== refreshGeneration.current ||
          selectedGroupRef.current?.groupId !== group.groupId
        ) {
          return "ignored";
        }
        if (result.kind === "not-modified") {
          validatorRef.current = result.validator;
          freshAtRef.current = result.freshAt;
          setFreshAt(result.freshAt);
          setFreshness("fresh");
          setTaskMessage(null);
          const current = snapshotRef.current;
          if (current) {
            await controller.saveCachedTaskList({
              freshAt: result.freshAt,
              group,
              snapshot: current,
              status: statusRef.current,
              validator: result.validator,
            }).catch(() => undefined);
          }
          return "not-modified";
        }
        if (gestureActive.current) {
          pendingChange.current = { group, result };
        } else {
          await applyChanged(group, result);
        }
        return "changed";
      } catch (error) {
        if (generation !== refreshGeneration.current) return "ignored";
        if (isRevoked(error)) {
          onSessionRevoked();
          return "error";
        }
        if (error instanceof OpenJobApiError && error.status === 404) {
          try {
            await controller.purgeCachedTaskList();
          } catch {
            onSessionRevoked();
            return "error";
          }
          clearSelection();
          await loadGroups(
            `${group.name} is no longer accessible. Choose another Group.`,
          );
          return "error";
        }
        setFreshness(snapshotRef.current ? "offline" : null);
        setTaskMessage(
          snapshotRef.current
            ? staleMessage(freshAtRef.current, error)
            : errorMessage(error),
        );
        return "error";
      }
    })();
    refreshInFlight.current = operation;
    void operation.finally(() => {
      if (refreshInFlight.current === operation) refreshInFlight.current = null;
    });
    return operation;
  }, [applyChanged, clearSelection, controller, loadGroups, onSessionRevoked, sessionReady]);

  useEffect(() => {
    if (
      !cacheLoaded ||
      !sessionReady ||
      !selectedGroup ||
      showChooser ||
      !isFocused ||
      appState !== "active"
    ) {
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const outcome = await runRefresh();
      if (!active) return;
      const unchanged = outcome === "not-modified" || outcome === "error";
      const delay = nextPollDelayMs(unchanged ? unchangedCount.current : 0);
      unchangedCount.current = unchanged ? unchangedCount.current + 1 : 0;
      timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [appState, cacheLoaded, isFocused, runRefresh, selectedGroup, sessionReady, showChooser]);

  const selectGroup = useCallback(
    (group: NativeGroup) => {
      if (selectedGroupRef.current?.groupId === group.groupId) {
        setShowChooser(false);
        return;
      }
      refreshGeneration.current += 1;
      refreshInFlight.current = null;
      unchangedCount.current = 0;
      selectedGroupRef.current = group;
      snapshotRef.current = null;
      validatorRef.current = null;
      freshAtRef.current = null;
      statusRef.current = "open";
      pendingChange.current = null;
      if (removalTimer.current) clearTimeout(removalTimer.current);
      removalTimer.current = null;
      setSelectedGroup(group);
      setShowChooser(false);
      setSnapshot(null);
      setTaskMessage(null);
      setStatus("open");
      setFreshAt(null);
      setFreshness(null);
      setRemovingTaskIds(new Set());
    },
    [],
  );

  const selectStatus = useCallback(
    (next: TaskStatus) => {
      statusRef.current = next;
      setStatus(next);
      const group = selectedGroupRef.current;
      const current = snapshotRef.current;
      const currentValidator = validatorRef.current;
      const currentFreshAt = freshAtRef.current;
      if (group && current && currentValidator && currentFreshAt) {
        void controller.saveCachedTaskList({
          freshAt: currentFreshAt,
          group,
          snapshot: current,
          status: next,
          validator: currentValidator,
        }).catch(() => undefined);
      }
    },
    [controller],
  );

  const retryTaskList = useCallback(() => {
    unchangedCount.current = 0;
    if (!sessionReady) {
      onRestoreSession();
      return;
    }
    setRefreshing(true);
    void runRefresh().finally(() => setRefreshing(false));
  }, [onRestoreSession, runRefresh, sessionReady]);

  const sections = useMemo(
    () => (snapshot ? sectionsFor(snapshot, status) : []),
    [snapshot, status],
  );
  const visibleTaskMessage =
    !sessionReady && snapshot && restoreReason
      ? staleMessage(
          freshAt,
          restoreReason === "offline"
            ? new ProviderSignInError("offline")
            : new ProviderSignInError("unavailable"),
        )
      : taskMessage;

  if (!selectedGroup || showChooser) {
    return (
      <GroupChooser
        groups={groups}
        loading={groupsLoading}
        message={groupMessage}
        onEscape={
          selectedGroup ? () => setShowChooser(false) : undefined
        }
        onRetry={() => void loadGroups()}
        onSelect={(group) => void selectGroup(group)}
      />
    );
  }

  const taskList = snapshot || visibleTaskMessage ? (
    <SectionList
      contentContainerStyle={[
        styles.taskListContent,
        wide && styles.taskListContentWide,
      ]}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(task) => task.taskId}
      ListEmptyComponent={
        visibleTaskMessage ? null : (
          <View style={styles.emptyTaskState}>
            <Text style={[styles.stateTitle, { color: palette.ink }]}>
              {`No ${status === "all" ? "" : `${status} `}Tasks`}
            </Text>
            <Text style={[styles.stateMessage, { color: palette.muted }]}>
              {status === "all"
                ? "This Group's Task List is empty."
                : `Choose another filter to read this Group's ${status === "open" ? "completed" : "open"} work.`}
            </Text>
          </View>
        )
      }
      ListHeaderComponent={
        <TaskListHeader
          freshnessMessage={
            freshness === "fresh" && freshAt
              ? `Fresh · Last checked ${readableTimestamp(freshAt)}.`
              : null
          }
          group={selectedGroup}
          onRetry={retryTaskList}
          onShowChooser={() => setShowChooser(true)}
          retryMessage={visibleTaskMessage}
          setStatus={selectStatus}
          snapshot={snapshot ?? emptySnapshot}
          status={status}
          wide={wide}
        />
      }
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onMomentumScrollBegin={() => {
        momentumActive.current = true;
      }}
      onMomentumScrollEnd={() => {
        momentumActive.current = false;
        applyPendingChange();
      }}
      onRefresh={retryTaskList}
      onScrollBeginDrag={() => {
        gestureActive.current = true;
      }}
      onScrollEndDrag={finishDrag}
      refreshing={refreshing}
      renderItem={({ item }) => (
        <TaskRow
          animate={changedTaskIds.has(item.taskId)}
          reducedMotion={reducedMotion}
          removing={removingTaskIds.has(item.taskId)}
          task={item}
        />
      )}
      renderSectionHeader={({ section }) => (
        <Text
          accessibilityLabel={section.screenReaderLabel}
          accessibilityRole="header"
          style={[
            styles.sectionHeader,
            { backgroundColor: palette.background, color: palette.ink },
          ]}
        >
          {section.label}
        </Text>
      )}
      sections={sections}
      stickySectionHeadersEnabled
      testID="openjob-task-list"
    />
  ) : (
    <View
      accessibilityLabel={`Loading ${selectedGroup.name} Task List`}
      accessibilityRole="progressbar"
      style={styles.centeredState}
    >
      <ActivityIndicator color={palette.blue} size="large" />
      <Text style={[styles.stateTitle, { color: palette.ink }]}>
        Loading {selectedGroup.name}…
      </Text>
    </View>
  );

  return (
    <View
      style={[styles.adaptiveLayout, wide && styles.wideLayout]}
      testID="openjob-adaptive-layout"
    >
      {wide ? (
        <View
          accessibilityLabel="Groups"
          style={[
            styles.sidebar,
            { backgroundColor: palette.card, borderColor: palette.line },
          ]}
        >
          <Text
            accessibilityRole="header"
            style={[styles.sidebarTitle, { color: palette.ink }]}
          >
            Groups
          </Text>
          <ScrollView
            contentContainerStyle={styles.sidebarGroups}
            keyboardShouldPersistTaps="handled"
            style={styles.sidebarScroll}
            testID="openjob-group-sidebar-scroll"
          >
            <GroupControls
              groups={groups}
              onSelect={(group) => void selectGroup(group)}
              selectedGroupId={selectedGroup.groupId}
            />
          </ScrollView>
        </View>
      ) : null}
      <View key="task-list" style={styles.wideTaskList}>
        {taskList}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  adaptiveLayout: {
    flex: 1,
  },
  actionButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  actionButtonText: {
    fontFamily: "Geist_700Bold",
    fontSize: 15,
  },
  centeredState: {
    alignItems: "center",
    gap: 14,
    justifyContent: "center",
    minHeight: 260,
    padding: 24,
  },
  chooserContent: {
    alignSelf: "center",
    padding: 24,
    width: "100%",
  },
  chooserBrandmark: {
    height: 54,
    marginBottom: 22,
    width: 54,
  },
  chooserHeader: {
    alignSelf: "center",
    maxWidth: 680,
    paddingTop: 30,
    width: "100%",
  },
  chooserLede: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 26,
    marginTop: 14,
  },
  chooserTitle: {
    fontFamily: "Geist_900Black",
    fontSize: 42,
    letterSpacing: -2,
    lineHeight: 47,
    marginTop: 8,
  },
  emptyTaskState: {
    gap: 10,
    minHeight: 220,
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  filterCount: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 13,
  },
  filterLabel: {
    fontFamily: "Geist_700Bold",
    fontSize: 15,
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterTab: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 86,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  freshness: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 13,
    lineHeight: 19,
  },
  groupButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    minHeight: 62,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  groupButtonCopy: {
    flex: 1,
    gap: 2,
  },
  groupButtonName: {
    fontFamily: "Geist_700Bold",
    fontSize: 16,
  },
  groupButtonRole: {
    fontFamily: "Geist_400Regular",
    fontSize: 12,
  },
  groupChoices: {
    alignSelf: "center",
    gap: 10,
    marginTop: 28,
    maxWidth: 680,
    width: "100%",
  },
  kicker: {
    fontFamily: "Geist_700Bold",
    fontSize: 11,
    letterSpacing: 1.6,
  },
  listHeader: {
    gap: 22,
    paddingBottom: 28,
  },
  narrowSwitcher: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  notice: {
    borderLeftWidth: 4,
    gap: 14,
    marginTop: 22,
    padding: 16,
  },
  noticeText: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 23,
  },
  sectionHeader: {
    fontFamily: "Geist_700Bold",
    fontSize: 18,
    paddingBottom: 10,
    paddingTop: 24,
  },
  sidebar: {
    borderRightWidth: 1,
    gap: 18,
    padding: 18,
    width: 280,
  },
  sidebarGroups: {
    gap: 8,
  },
  sidebarTitle: {
    fontFamily: "Geist_900Black",
    fontSize: 24,
    letterSpacing: -0.8,
  },
  sidebarScroll: {
    flex: 1,
  },
  stateMessage: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 440,
    textAlign: "center",
  },
  stateTitle: {
    fontFamily: "Geist_700Bold",
    fontSize: 22,
    textAlign: "center",
  },
  switcherLabel: {
    fontFamily: "Geist_700Bold",
    fontSize: 10,
    letterSpacing: 1.1,
  },
  switcherName: {
    fontFamily: "Geist_700Bold",
    fontSize: 18,
  },
  taskBadge: {
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  taskBadgeText: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 11,
  },
  taskBadges: {
    alignItems: "flex-end",
    gap: 6,
  },
  taskCopy: {
    flex: 1,
    gap: 9,
  },
  taskListContent: {
    paddingBottom: 56,
    paddingHorizontal: 18,
    paddingTop: 22,
  },
  taskListContentWide: {
    alignSelf: "center",
    maxWidth: 920,
    paddingHorizontal: 32,
    width: "100%",
  },
  taskListTitle: {
    fontFamily: "Geist_900Black",
    fontSize: 40,
    letterSpacing: -1.8,
    lineHeight: 44,
  },
  taskListTitleBlock: {
    gap: 7,
  },
  taskMetaText: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 12,
  },
  taskMetadata: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  taskRow: {
    alignItems: "flex-start",
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    minHeight: 88,
    padding: 16,
  },
  taskText: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 16,
    lineHeight: 23,
  },
  wideLayout: {
    flex: 1,
    flexDirection: "row",
  },
  wideTaskList: {
    flex: 1,
  },
});
