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
- `db/tasks.ts` — task storage adapter
- `db/firestore.ts` — authenticated Firestore REST client
- `firestore.rules` — browser access is denied; the Worker owns data access

## Services

Cloudflare Workers hosts the app at `openjob.dev`. Firebase project
`openjob-dev` stores task records in Firestore. The Firebase service-account
credentials live only in Cloudflare Worker secrets.

Deploy Firestore rules and the site with:

```bash
npm run firebase:deploy:rules
npm run deploy
```
