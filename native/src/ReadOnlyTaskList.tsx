import { Feather } from "@expo/vector-icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
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
import type {
  NativeGroup,
  NativeTask,
  NativeTaskListController,
  NativeTaskListSnapshot,
} from "./task-list-contracts";
import { useOpenJobTheme } from "./theme";
import { useControlInteraction } from "./use-control-interaction";

type TaskStatus = "open" | "done" | "all";
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

function TaskRow({ task }: { task: NativeTask }) {
  const { palette } = useOpenJobTheme();
  const due = dueDescription(task);
  return (
    <View
      accessible
      accessibilityLabel={taskAccessibilityLabel(task)}
      style={[
        styles.taskRow,
        { backgroundColor: palette.paper, borderColor: palette.line },
      ]}
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
    </View>
  );
}

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
  group,
  onRetry,
  onShowChooser,
  retryMessage,
  snapshot,
  status,
  wide,
  setStatus,
}: {
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

export function ReadOnlyTaskList({
  controller,
  onSessionRevoked,
}: {
  controller: NativeTaskListController;
  onSessionRevoked: () => void;
}) {
  const { width } = useWindowDimensions();
  const { palette } = useOpenJobTheme();
  const wide = width >= 760;
  const requestGeneration = useRef(0);
  const [groups, setGroups] = useState<NativeGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupMessage, setGroupMessage] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<NativeGroup | null>(null);
  const [showChooser, setShowChooser] = useState(true);
  const [snapshot, setSnapshot] = useState<NativeTaskListSnapshot | null>(null);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatus>("open");

  const loadGroups = useCallback(
    async (message: string | null = null) => {
      const generation = ++requestGeneration.current;
      setGroupsLoading(true);
      setGroupMessage(message);
      try {
        const nextGroups = await controller.listGroups();
        if (generation !== requestGeneration.current) return;
        setGroups(nextGroups);
        setGroupMessage(message);
      } catch (error) {
        if (generation !== requestGeneration.current) return;
        if (isRevoked(error)) {
          onSessionRevoked();
          return;
        }
        setGroups([]);
        setGroupMessage(errorMessage(error));
      } finally {
        if (generation === requestGeneration.current) setGroupsLoading(false);
      }
    },
    [controller, onSessionRevoked],
  );

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadGroups();
    });
    return () => {
      active = false;
      requestGeneration.current += 1;
    };
  }, [loadGroups]);

  const selectGroup = useCallback(
    async (group: NativeGroup) => {
      const generation = ++requestGeneration.current;
      setSelectedGroup(group);
      setShowChooser(false);
      setSnapshot(null);
      setTaskMessage(null);
      setStatus("open");
      try {
        const nextSnapshot = await controller.readTaskList(group.groupId);
        if (generation !== requestGeneration.current) return;
        setSnapshot(nextSnapshot);
      } catch (error) {
        if (generation !== requestGeneration.current) return;
        if (isRevoked(error)) {
          onSessionRevoked();
          return;
        }
        if (error instanceof OpenJobApiError && error.status === 404) {
          setSelectedGroup(null);
          setShowChooser(true);
          setSnapshot(null);
          await loadGroups(
            `${group.name} is no longer accessible. Choose another Group.`,
          );
          return;
        }
        setTaskMessage(errorMessage(error));
      }
    },
    [controller, loadGroups, onSessionRevoked],
  );

  const sections = useMemo(
    () => (snapshot ? sectionsFor(snapshot, status) : []),
    [snapshot, status],
  );

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

  const taskList = snapshot || taskMessage ? (
    <SectionList
      contentContainerStyle={[
        styles.taskListContent,
        wide && styles.taskListContentWide,
      ]}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(task) => task.taskId}
      ListEmptyComponent={
        taskMessage ? null : (
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
          group={selectedGroup}
          onRetry={() => void selectGroup(selectedGroup)}
          onShowChooser={() => setShowChooser(true)}
          retryMessage={taskMessage}
          setStatus={setStatus}
          snapshot={snapshot ?? emptySnapshot}
          status={status}
          wide={wide}
        />
      }
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      renderItem={({ item }) => <TaskRow task={item} />}
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
