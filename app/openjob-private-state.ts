export const SELECTED_GROUP_KEY = "openjob:selected-group-id";
export const TASK_EDITOR_DRAFT_KEY = "openjob:pending-task-editor";

export function clearBrowserPrivateState({
  preserveTaskDraft = false,
}: {
  preserveTaskDraft?: boolean;
} = {}) {
  if (typeof window === "undefined") return;
  let failure: unknown;
  try {
    window.localStorage.removeItem(SELECTED_GROUP_KEY);
  } catch (error) {
    failure = error;
  }
  if (!preserveTaskDraft) {
    try {
      window.sessionStorage.removeItem(TASK_EDITOR_DRAFT_KEY);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}
