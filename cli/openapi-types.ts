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
