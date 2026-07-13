import { createTask, listTasks, setTaskCompleted } from "@/db/tasks";

function parseTaskText(text: string) {
  const match = text
    .trim()
    .match(/^@([a-zA-Z0-9][a-zA-Z0-9._-]{0,31})\s*(?:[-–—:]\s*|\s+)(.+)$/);
  if (!match) return null;
  return { assignee: match[1].toLowerCase(), description: match[2].trim() };
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export async function GET() {
  try {
    const tasks = await listTasks();
    return Response.json(
      { tasks },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: unknown; dueDate?: unknown };
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim() || text.length > 240) {
      return Response.json({ error: "Enter a task under 240 characters." }, { status: 400 });
    }

    const parsed = parseTaskText(text);
    if (!parsed?.description) {
      return Response.json(
        { error: "Start with a name, like @shane — Take out trash." },
        { status: 400 },
      );
    }

    const dueDate =
      typeof body.dueDate === "string" && body.dueDate ? body.dueDate : null;
    if (dueDate && !isValidDate(dueDate)) {
      return Response.json({ error: "Choose a valid due date." }, { status: 400 });
    }

    const task = await createTask({ ...parsed, dueDate });
    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { id?: unknown; completed?: unknown };
    if (typeof body.id !== "string" || typeof body.completed !== "boolean") {
      return Response.json({ error: "Invalid task update." }, { status: 400 });
    }

    const task = await setTaskCompleted(body.id, body.completed);
    if (!task) {
      return Response.json({ error: "That task no longer exists." }, { status: 404 });
    }
    return Response.json({ task });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
