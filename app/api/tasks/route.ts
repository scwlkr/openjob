import { listTasks } from "@/db/tasks";
import { createLegacyBoardApi } from "@/server/legacy-board";

const legacyBoard = createLegacyBoardApi({
  listTasks,
  mode: "unavailable",
});

export function GET(request: Request) {
  return legacyBoard.fetch(request);
}

export function POST(request: Request) {
  return legacyBoard.fetch(request);
}

export function PATCH(request: Request) {
  return legacyBoard.fetch(request);
}
