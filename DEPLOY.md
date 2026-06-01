# Deploying AI Quant Assistant

This app is a **monorepo** with two runtime services:

| Service | Stack | Default port | Notes |
|---------|-------|--------------|-------|
| **web** | Next.js 15 (`apps/web`) | 3002 dev / 3000 prod | Browser calls `/quant-api/*` (same-origin proxy) |
| **api** | FastAPI (`apps/api`) | 8001 | Backtest jobs live **in memory**; restart = lost jobs |

**Required secret:** `GEMINI_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY`) for AI narratives.

---

## Architecture choices

### Recommended: single VPS + Docker Compose (simplest)

- One domain, nginx → Next.js → internal FastAPI.
- No browser CORS issues (proxy handles API).
- One long-lived API process keeps in-memory jobs alive until restart/deploy.
- Best for demos and small teams.

**Files:** `docker-compose.prod.yml`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `deploy/nginx/nginx.conf`

### Render Blueprint (web + API)

Use the repo-root [`render.yaml`](render.yaml) when the Render UI does not expose Dockerfile path fields (common on monorepos):

1. **Dashboard → Blueprints → New Blueprint Instance** → connect `jagahow-bot/jasper-ai`.
2. Render creates **jasper-ai-api** (`apps/api/Dockerfile`, context `.`) and **jasper-ai-web** (`apps/web/Dockerfile`, context `.`).
3. `QUANT_API_URL` on web is wired from the API service’s public URL (`RENDER_EXTERNAL_URL`).
4. Set **`GEMINI_API_KEY`** on the API service and **`GOOGLE_GENERATIVE_AI_API_KEY`** on web in the Render dashboard (required for AI features).

Keep **one API instance** — backtest jobs are in-memory.

### Optional split: Vercel (web) + Railway / Fly / Render (API)

- **Web on Vercel:** set `QUANT_API_URL=https://your-api-host` (server-side proxy).
- **API on PaaS:** set `GEMINI_API_KEY`, `API_CORS_ORIGINS` (only needed if browsers call API directly).
- **Job caveat:** serverless API instances scale to zero / rotate — **in-flight backtests may be lost**. Use a always-on API container (Railway/Fly min instances = 1) for serious use.

### Not recommended alone

- **API-only on serverless** without sticky sessions — job IDs will 404 across instances.
- **Multiple uvicorn workers** — job dict is per-process; keep `--workers 1` (already set in Dockerfile).

---

## A. VPS deployment (Docker Compose)

### Prerequisites

- Linux VPS (Ubuntu 22.04+), 2+ GB RAM (VectorBT/Optuna build is heavy).
- Docker Engine + Docker Compose v2.
- Domain DNS → server IP (optional but recommended).
- [Google AI Studio](https://aistudio.google.com/apikey) Gemini API key.

### 1. Clone and configure

```bash
git clone https://github.com/YOUR_USER/ai-quant-assistant.git
cd ai-quant-assistant
cp .env.production.example .env.production
nano .env.production   # fill GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY
```

Set `API_CORS_ORIGINS` to your public URL, e.g. `https://quant.example.com`.

### 2. Build and run

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl -s http://localhost/quant-api/health
```

Open `http://YOUR_SERVER_IP/` (or your domain).

### 3. HTTPS (Let's Encrypt)

Put nginx in front with TLS (example using host certbot + reverse proxy), or replace the bundled nginx service with Caddy/Traefik. Minimum:

- Point `A` record to VPS.
- Terminate TLS at nginx/Caddy on 443 → proxy to `web:3000`.

### 4. Updates

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

**Warning:** rebuilding restarts API → **running backtests are lost**.

### 5. Firewall

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Do **not** expose port 8001 publicly; only nginx (80/443) should be public.

---

## B. Vercel + Railway (split)

### B1. Deploy API (Railway example)

1. New project → **Deploy from GitHub** → this repo.
2. Set **root directory** / Dockerfile path: `apps/api/Dockerfile`, build context = repo root  
   Or use Nixpacks with start command:
   `cd apps/api && pip install -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1`
3. Variables:
   - `GEMINI_API_KEY`
   - `API_CORS_ORIGINS=https://YOUR-VERCEL-APP.vercel.app`
   - `PORT` (Railway sets automatically)
4. Copy public URL, e.g. `https://ai-quant-api-production.up.railway.app`
5. Health check path: `/health`

**Fly.io:** similar — `fly launch` in repo, use `apps/api/Dockerfile`, `internal_port = 8001`, scale `min_machines_running = 1`.

### B2. Deploy web (Vercel)

1. Import repo → set **Root Directory** to `apps/web`.
2. Environment variables:

   | Variable | Value |
   |----------|--------|
   | `QUANT_API_URL` | `https://your-railway-api-url` (no trailing slash) |
   | `GOOGLE_GENERATIVE_AI_API_KEY` | your key |
   | `GEMINI_MODEL` | `gemini-3.5-flash` |

3. Deploy. Browser uses `/quant-api` proxy; `QUANT_API_URL` is read server-side in `apps/web/src/app/quant-api/[[...path]]/route.ts`.

4. Optional: `NEXT_PUBLIC_API_URL` only if you bypass the proxy (not default).

### B3. Custom domain

- Vercel: add domain in project settings.
- Railway/Fly: add API subdomain `api.yourdomain.com`.
- Update `API_CORS_ORIGINS` on API if clients hit API directly.

---

## Environment reference

| Variable | Where | Purpose |
|----------|-------|---------|
| `GEMINI_API_KEY` | API | Gemini for narratives / seeds |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Web | Same key alias for Next routes |
| `QUANT_API_URL` | Web (server) | Upstream for `/quant-api` proxy |
| `NEXT_PUBLIC_API_URL` | Web (build) | SSR direct API URL; empty when using proxy |
| `API_CORS_ORIGINS` | API | Comma-separated allowed origins |
| `HTTP_PORT` | Compose | Host port mapped to nginx (default 80) |

See `.env.production.example` and `.env.example` for tuning knobs (`GEMINI_THINKING_LEVEL`, etc.).

---

## Health checks

| Endpoint | Service |
|----------|---------|
| `GET /health` | FastAPI (direct or via `/quant-api/health`) |
| `GET /` | Next.js |

Docker Compose healthchecks are defined in `docker-compose.prod.yml`.

---

## Local Docker verification

From repo root:

```bash
cp .env.production.example .env.production
# Edit .env.production and add a real GEMINI_API_KEY for full tests

docker build -f apps/api/Dockerfile -t ai-quant-api:local .
docker build -f apps/web/Dockerfile -t ai-quant-web:local .

docker compose -f docker-compose.prod.yml up -d --build
curl -s http://localhost/quant-api/health
```

---

## What you must provide

1. **Hosting choice** — VPS Compose vs Vercel+Railway.
2. **Domain + DNS** (optional for IP-only demos).
3. **`GEMINI_API_KEY`** in `.env.production` or host dashboards.
4. **Accept job loss on deploy/restart** (or plan Redis/DB jobs later).

This repository does **not** store cloud credentials. Do not commit `.env.production`.

---

## 中文摘要（部署要点）

1. **应用结构**：Next.js 前端 + FastAPI 量化 API；回测任务在 API **内存**里，重启会丢任务。
2. **推荐新手路径**：一台 VPS + `docker-compose.prod.yml`（nginx 对外 80 端口，内部 Next 代理 `/quant-api` 到 API）。
3. **操作步骤**：复制 `.env.production.example` → `.env.production`，填入 `GEMINI_API_KEY`，执行 `docker compose -f docker-compose.prod.yml up -d --build`，浏览器访问服务器 IP 或域名。
4. **可选方案**：前端 Vercel（设 `QUANT_API_URL` 指向线上 API）+ 后端 Railway/Fly（Dockerfile 在 `apps/api`，**保持 1 个常驻实例**）。
5. **不要**把 `.env.production` 提交到 Git；API 的 8001 端口不要直接暴露公网。
