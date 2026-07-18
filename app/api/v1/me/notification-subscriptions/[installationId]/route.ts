import { handleV1NotificationSubscriptionsRequest } from "@/server/v1-runtime";

export function GET(request: Request) {
  return handleV1NotificationSubscriptionsRequest(request);
}

export function PUT(request: Request) {
  return handleV1NotificationSubscriptionsRequest(request);
}

export function PATCH(request: Request) {
  return handleV1NotificationSubscriptionsRequest(request);
}
