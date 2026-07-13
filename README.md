# Openjob

A small public task board for teams. Add tasks with `@name — task`, optionally
assign a date, then check them off.

## Run it

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Use `npm test` before committing larger changes.

## Where things live

- `app/page.tsx` — task-board interface and interactions
- `app/globals.css` — all styling
- `app/api/tasks/route.ts` — task API
- `db/tasks.ts` — database queries
- `db/schema.ts` — task schema
- `drizzle/` — database migrations

## Services

The current data layer uses Cloudflare D1 through the logical `DB` binding in
`.openai/hosting.json`. Local development supplies a local D1 database, so no
account or keys are needed to start working.

If you later choose Supabase, Neon, Firebase, or another database, keep the API
contract in `app/api/tasks/route.ts` and replace the functions in `db/tasks.ts`.
That isolates the service migration from the interface.

This copy has no Sites project ID and no Git remote. It cannot overwrite the
original Open List deployment. Add your own remote with:

```bash
git remote add origin YOUR_REPOSITORY_URL
git push -u origin main
```

For a new Sites deployment, ask Codex to publish this folder; Sites will create
a separate project and database for Openjob.
