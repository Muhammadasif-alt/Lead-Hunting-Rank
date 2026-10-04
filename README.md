# Rank High Lead — AI Sales Operating System

(Internal code name: Revenue OS — package names use `@revenue-os/*`.)

AI Sales Operating System: user goal define kare, system prospect discovery → research → outreach → meeting booking tak kaam kare.
Product vision: [docs/00-vision.md](docs/00-vision.md) · Kahan tak pohanche: **[docs/PROGRESS.md](docs/PROGRESS.md)**

---

## 🚀 Quick start (pehli dafa)

**Zaroori cheezein:** Node 24+, pnpm, Docker Desktop (Windows pe WSL ke saath — neeche dekhein).

```bash
pnpm install        # sab dependencies (poore monorepo ki ek hi dafa)
pnpm setup          # .env banata hai + Node/Docker check karta hai
pnpm infra:up       # PostgreSQL + Redis Docker mein start
pnpm db:deploy       # database tables banata hai (migrations)
pnpm db:seed         # dev workspace + owner user + roles + default pipeline
pnpm dev            # web + api + worker ek saath start
```

Phir browser mein kholein: **http://localhost:3000/login** — dev users (`pnpm db:seed` se), sab ka password `rankhighlead-dev`:
`owner@` · `admin@` · `sales@` · `researcher@` · `viewer@rankhighlead.dev` (login page pe buttons bhi hain).

System check: **http://localhost:3000/diagnostics** — paanchon rows ✓ honi chahiye:
Web · API · PostgreSQL · Redis · Worker.

Roz ka kaam: `pnpm infra:up` (agar Docker band tha) → `pnpm dev`. Band karna: `Ctrl+C`, phir `pnpm infra:down`.

### Windows: Docker Desktop nahi chal raha?
Docker Desktop ko **WSL 2** chahiye. Admin PowerShell mein:
```powershell
wsl --install
```
Computer restart karein → Docker Desktop kholein → jab "Engine running" dikhe, `pnpm infra:up` chalayein.

---

## 🗂️ Project ka naqsha

```
apps/
  web/        Next.js frontend (port 3000)
              src/app/page.tsx       → landing page (components/landing/)
              src/app/(app)/…        → app screens, shared sidebar/topbar (components/app/)
              src/lib/screens.ts     → screen list: naam, icon, section, kis phase mein live
              src/lib/roadmap.ts     → phases ki progress (docs/PROGRESS.md ke saath sync)
  api/        NestJS backend (port 4000) — saari business logic, /api/*
  worker/     BullMQ background jobs — discovery, research, email, AI...
packages/
  config/     .env ko typed + validate karta hai (galat config = saaf error)
  shared/     queue names, types, helpers — sab apps mein common
  database/   Prisma schema + client (PostgreSQL)
  events/     domain events + outbox            ← Phase 4
  policy/     ACT / ASK / WAIT / BLOCK engine   ← Phase 10
  providers/  Gmail, Calendar, LLM, lead-data adapters ← Phase 5
  ai/         AI runtime, agents, prompts       ← Phase 9
infrastructure/
  docker/     docker-compose.dev.yml (Postgres + Redis)
docs/         Saari locked specifications (pehle yahan parhein)
scripts/      setup + helper scripts
```

Request ka raasta: **Browser → web (Next.js) → `/api/*` → api (NestJS) → PostgreSQL**,
aur lambe kaam: **api → Redis/BullMQ queue → worker → result → PostgreSQL**.

---

## 🧰 Commands

| Command | Kya karta hai |
|---|---|
| `pnpm dev` | Sab kuch start (web + api + worker + packages watch) |
| `pnpm dev:web` / `dev:api` / `dev:worker` | Sirf ek app |
| `pnpm infra:up` / `infra:down` / `infra:logs` | Docker Postgres + Redis |
| `pnpm build` | Sab build |
| `pnpm typecheck` | TypeScript errors check |
| `pnpm test` | Saare tests (database tests `revenue_os_test` DB khud bana lete hain — Docker chalna chahiye) |
| `pnpm db:migrate` | Schema badla? Nayi Prisma migration banao + chalao |
| `pnpm db:deploy` | Maujooda migrations database pe lagao (pull ke baad) |
| `pnpm db:seed` | Dev data: workspace, owner, roles, pipeline (dobara chalana safe hai) |
| `pnpm db:studio` | Database browser mein dekho |
| `pnpm format` | Code format (Prettier) |

**Ports:** web 3000 · api 4000 · Postgres **5433** · Redis **6380** (5432/6379 is liye nahi taake pehle se install Postgres/Redis se takraav na ho). Sab `.env` mein badle ja sakte hain.

---

## 📚 Docs kahan hain

| File | Kya hai |
|---|---|
| [AI-INSTRUCTIONS.md](AI-INSTRUCTIONS.md) | Kisi bhi AI tool (Claude, Copilot...) ke liye rules — pehle ye |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Kaunsa phase complete, agla kya |
| [docs/00-vision.md](docs/00-vision.md) · [02-master-specification-v1.md](docs/02-master-specification-v1.md) | Product kya hai |
| [docs/screens/](docs/screens/) | 18 screens ka behaviour spec |
| `docs/04` … `docs/16` | Technical specs (architecture, DB, events, agents, policy, queues…) |
| [docs/17-tech-spec-13-implementation-roadmap.md](docs/17-tech-spec-13-implementation-roadmap.md) | Build order — Phase 0 → 24 |
