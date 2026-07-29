import type { AccountDeletionStatusReceipt } from "./openjob-contracts";
import { isOpenJobTimestamp } from "./openjob-timestamp";

export const SELECTED_GROUP_KEY = "openjob:selected-group-id";
export const TASK_EDITOR_DRAFT_KEY = "openjob:pending-task-editor";
export const ACCOUNT_DELETION_STATUS_RECEIPT_KEY =
  "openjob:account-deletion-status-receipt";
export const ACCOUNT_DELETION_RECEIPT_OWNER_KEY =
  "openjob:account-deletion-receipt-owner";
const ACCOUNT_DELETION_TAB_ID_KEY = "openjob:account-deletion-tab-id";
let accountDeletionTabId: string | null = null;

type AccountDeletionReceiptOwner = {
  ownerId: string;
  statusToken: string;
  submissionExpiresAt: string;
  version: 1;
};

function isStatusToken(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 8_192 &&
    /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function parseAccountDeletionStatusReceipt(
  value: string,
): AccountDeletionStatusReceipt {
  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    throw new Error("The saved deletion status receipt is invalid.");
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(",") !==
      "phase,statusToken,submissionExpiresAt,version"
  ) {
    throw new Error("The saved deletion status receipt is invalid.");
  }
  const receipt = input as Record<string, unknown>;
  if (
    receipt.version !== 1 ||
    (receipt.phase !== "completed" &&
      receipt.phase !== "prepared" &&
      receipt.phase !== "submitting") ||
    !isStatusToken(receipt.statusToken) ||
    (receipt.submissionExpiresAt !== null &&
      !isOpenJobTimestamp(receipt.submissionExpiresAt)) ||
    (receipt.phase === "prepared" && receipt.submissionExpiresAt === null)
  ) {
    throw new Error("The saved deletion status receipt is invalid.");
  }
  return receipt as AccountDeletionStatusReceipt;
}

function serializedReceipt(receipt: AccountDeletionStatusReceipt) {
  return JSON.stringify({
    phase: receipt.phase,
    statusToken: receipt.statusToken,
    submissionExpiresAt: receipt.submissionExpiresAt,
    version: receipt.version,
  });
}

function currentTabId() {
  if (accountDeletionTabId !== null) return accountDeletionTabId;
  const existing = window.sessionStorage.getItem(ACCOUNT_DELETION_TAB_ID_KEY);
  const navigation = window.performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  const generated = navigation?.type === "reload" &&
      existing && /^[a-f0-9]{32}$/u.test(existing)
    ? existing
    : [...crypto.getRandomValues(new Uint8Array(16))]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  window.sessionStorage.setItem(ACCOUNT_DELETION_TAB_ID_KEY, generated);
  if (window.sessionStorage.getItem(ACCOUNT_DELETION_TAB_ID_KEY) !== generated) {
    throw new Error("The deletion tab owner could not be saved.");
  }
  accountDeletionTabId = generated;
  return accountDeletionTabId;
}

function serializedOwner(owner: AccountDeletionReceiptOwner) {
  return JSON.stringify({
    ownerId: owner.ownerId,
    statusToken: owner.statusToken,
    submissionExpiresAt: owner.submissionExpiresAt,
    version: owner.version,
  });
}

function parseOwner(value: string): AccountDeletionReceiptOwner | null {
  try {
    const input = JSON.parse(value) as unknown;
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(",") !==
        "ownerId,statusToken,submissionExpiresAt,version"
    ) return null;
    const owner = input as Record<string, unknown>;
    return owner.version === 1 &&
        typeof owner.ownerId === "string" &&
        /^[a-f0-9]{32}$/u.test(owner.ownerId) &&
        isStatusToken(owner.statusToken) &&
        isOpenJobTimestamp(owner.submissionExpiresAt)
      ? owner as AccountDeletionReceiptOwner
      : null;
  } catch {
    return null;
  }
}

function clearMatchingOwner(statusToken: string) {
  const value = window.localStorage.getItem(ACCOUNT_DELETION_RECEIPT_OWNER_KEY);
  if (value === null) return;
  const owner = parseOwner(value);
  if (owner && owner.statusToken !== statusToken) return;
  window.localStorage.removeItem(ACCOUNT_DELETION_RECEIPT_OWNER_KEY);
}

function sameReceipt(
  left: AccountDeletionStatusReceipt,
  right: AccountDeletionStatusReceipt,
) {
  return serializedReceipt(left) === serializedReceipt(right);
}

export function loadAccountDeletionStatusReceipt():
  | AccountDeletionStatusReceipt
  | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(
    ACCOUNT_DELETION_STATUS_RECEIPT_KEY,
  );
  return value === null ? null : parseAccountDeletionStatusReceipt(value);
}

export function saveAccountDeletionStatusReceipt(
  receipt: AccountDeletionStatusReceipt,
) {
  if (typeof window === "undefined") return;
  const value = serializedReceipt(receipt);
  let ownerValue: string | null = null;
  if (receipt.phase === "prepared" && receipt.submissionExpiresAt !== null) {
    ownerValue = serializedOwner({
      ownerId: currentTabId(),
      statusToken: receipt.statusToken,
      submissionExpiresAt: receipt.submissionExpiresAt,
      version: 1,
    });
    window.localStorage.setItem(ACCOUNT_DELETION_RECEIPT_OWNER_KEY, ownerValue);
    if (
      window.localStorage.getItem(ACCOUNT_DELETION_RECEIPT_OWNER_KEY) !==
        ownerValue
    ) {
      throw new Error("The deletion tab owner could not be saved.");
    }
  }
  try {
    window.localStorage.setItem(ACCOUNT_DELETION_STATUS_RECEIPT_KEY, value);
    if (
      window.localStorage.getItem(ACCOUNT_DELETION_STATUS_RECEIPT_KEY) !== value
    ) {
      throw new Error("The deletion status receipt could not be saved.");
    }
  } catch (error) {
    if (ownerValue !== null) clearMatchingOwner(receipt.statusToken);
    throw error;
  }
  if (receipt.phase === "completed") clearMatchingOwner(receipt.statusToken);
}

export function accountDeletionReceiptOwnedByAnotherTab(
  receipt: AccountDeletionStatusReceipt,
) {
  if (
    typeof window === "undefined" ||
    receipt.phase === "completed" ||
    receipt.submissionExpiresAt === null ||
    Date.parse(receipt.submissionExpiresAt) <= Date.now()
  ) return false;
  const value = window.localStorage.getItem(ACCOUNT_DELETION_RECEIPT_OWNER_KEY);
  if (value === null) return false;
  const owner = parseOwner(value);
  if (!owner) return true;
  if (
    owner.statusToken !== receipt.statusToken ||
    owner.submissionExpiresAt !== receipt.submissionExpiresAt
  ) return false;
  try {
    return owner.ownerId !== currentTabId();
  } catch {
    return true;
  }
}

export function releaseAccountDeletionReceiptOwnership(
  receipt: AccountDeletionStatusReceipt,
) {
  if (typeof window === "undefined") return;
  const value = window.localStorage.getItem(ACCOUNT_DELETION_RECEIPT_OWNER_KEY);
  if (value === null) return;
  const owner = parseOwner(value);
  if (
    !owner ||
    owner.statusToken !== receipt.statusToken ||
    owner.ownerId !== currentTabId()
  ) return;
  window.localStorage.removeItem(ACCOUNT_DELETION_RECEIPT_OWNER_KEY);
  if (window.localStorage.getItem(ACCOUNT_DELETION_RECEIPT_OWNER_KEY) !== null) {
    throw new Error("The deletion tab owner could not be cleared.");
  }
}

export function clearAccountDeletionStatusReceipt(
  expected?: AccountDeletionStatusReceipt,
) {
  if (typeof window === "undefined") return true;
  if (expected) {
    const current = loadAccountDeletionStatusReceipt();
    if (current && !sameReceipt(current, expected)) return false;
  }
  window.localStorage.removeItem(ACCOUNT_DELETION_STATUS_RECEIPT_KEY);
  if (
    window.localStorage.getItem(ACCOUNT_DELETION_STATUS_RECEIPT_KEY) !== null
  ) {
    throw new Error("The deletion status receipt could not be cleared.");
  }
  if (expected) clearMatchingOwner(expected.statusToken);
  return true;
}

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
