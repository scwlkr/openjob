import type { operations } from "./generated/openapi";

type JsonResponse<T> = T extends {
  content: { "application/json": infer Body };
}
  ? Body
  : never;

export type CurrentUserResponse = JsonResponse<
  operations["getMe"]["responses"][200]
>;
export type ClaimUsernameRequest =
  operations["claimUsername"]["requestBody"]["content"]["application/json"];
export type ClaimUsernameResponse = JsonResponse<
  operations["claimUsername"]["responses"][200]
>;
export type ListGroupsResponse = JsonResponse<
  operations["listGroups"]["responses"][200]
>;
export type CreateGroupRequest =
  operations["createGroup"]["requestBody"]["content"]["application/json"];
export type CreateGroupResponse = JsonResponse<
  operations["createGroup"]["responses"][201]
>;
export type GetGroupResponse = JsonResponse<
  operations["getGroup"]["responses"][200]
>;
export type RenameGroupRequest =
  operations["renameGroup"]["requestBody"]["content"]["application/json"];
export type RenameGroupResponse = JsonResponse<
  operations["renameGroup"]["responses"][200]
>;
export type LeaveGroupOperation = operations["leaveGroup"];
export type EndGroupRequest =
  operations["endGroup"]["requestBody"]["content"]["application/json"];
export type EndGroupOperation = operations["endGroup"];
export type ListMembersResponse = JsonResponse<
  operations["listGroupMembers"]["responses"][200]
>;
export type KickMemberOperation = operations["kickGroupMember"];
export type PromoteMemberResponse = JsonResponse<
  operations["promoteGroupMember"]["responses"][200]
>;
export type DemoteMemberResponse = JsonResponse<
  operations["demoteGroupMember"]["responses"][200]
>;
export type ListBansResponse = JsonResponse<
  operations["listGroupBans"]["responses"][200]
>;
export type BanUserRequest =
  operations["banGroupUser"]["requestBody"]["content"]["application/json"];
export type BanUserResponse = JsonResponse<
  operations["banGroupUser"]["responses"][201]
>;
export type UnbanUserOperation = operations["unbanGroupUser"];
export type GetInviteLinkResponse = JsonResponse<
  operations["getGroupInviteLink"]["responses"][200]
>;
export type RotateInviteLinkResponse = JsonResponse<
  operations["rotateGroupInviteLink"]["responses"][200]
>;
export type InspectInviteResponse = JsonResponse<
  operations["inspectInviteLink"]["responses"][200]
>;
export type JoinInviteResponse = JsonResponse<
  operations["joinGroupWithInviteLink"]["responses"][200]
>;
export type ListTasksResponse = JsonResponse<
  operations["listGroupTasks"]["responses"][200]
>;
export type CreateTaskRequest =
  operations["createGroupTask"]["requestBody"]["content"]["application/json"];
export type CreateTaskResponse = JsonResponse<
  operations["createGroupTask"]["responses"][201]
>;
export type GetTaskResponse = JsonResponse<
  operations["getGroupTask"]["responses"][200]
>;
export type UpdateTaskRequest =
  operations["updateGroupTask"]["requestBody"]["content"]["application/json"];
export type UpdateTaskResponse = JsonResponse<
  operations["updateGroupTask"]["responses"][200]
>;
export type SetTaskStateRequest =
  operations["setGroupTaskState"]["requestBody"]["content"]["application/json"];
export type SetTaskStateResponse = JsonResponse<
  operations["setGroupTaskState"]["responses"][200]
>;
