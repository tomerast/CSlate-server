#!/bin/bash
# CSlate-Server — Full Local Dev Launcher
# Usage: pnpm dev
#
# Starts infrastructure via Docker, waits for health checks,
# then launches API server + worker with hot reload.
# Ctrl+C kills everything.

set -euo pipefail

# ── Colors ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_step() { echo -e "${CYAN}[dev]${NC} $1"; }
log_ok()   { echo -e "${GREEN}[dev]${NC} ✓ $1"; }
log_warn() { echo -e "${YELLOW}[dev]${NC} ⚠ $1"; }
log_err()  { echo -e "${RED}[dev]${NC} ✗ $1"; }

# ── Load .env.local ─────────────────────────────────────────────────────────────
if [ ! -f .env.local ]; then
  log_err ".env.local not found. Copy .env.local.example and fill in your values."
  exit 1
fi
set -a; source .env.local; set +a

# ── Step 1: Docker infrastructure ──────────────────────────────────────────────
log_step "Starting Docker services (postgres, minio, mailhog)..."
docker compose up -d --wait 2>&1 | grep -E "(started|healthy|error)" || true

# Wait for Postgres
log_step "Waiting for PostgreSQL..."
until docker exec cslate-postgres pg_isready -U cslate -d cslate_dev -q 2>/dev/null; do
  sleep 1
done
log_ok "PostgreSQL ready on :5432"
log_ok "MinIO ready on :9000 (UI: http://localhost:9001)"
log_ok "MailHog ready on :8025"

# ── Step 2: Migrations ─────────────────────────────────────────────────────────
log_step "Running database migrations..."
pnpm db:migrate 2>&1 | tail -5
log_ok "Migrations applied"

# ── Step 3: Seed (idempotent) ──────────────────────────────────────────────────
log_step "Seeding dev data..."
pnpm db:seed 2>&1 | grep -E "(✅|⚠|✗)" || true
log_ok "Dev seed complete"

# ── Step 4: Start API + Worker with hot reload ─────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  CSlate-Server local dev environment ready${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  API server:  ${BLUE}http://localhost:3000${NC}"
echo -e "  MinIO UI:    ${BLUE}http://localhost:9001${NC}  (minioadmin / minioadmin)"
echo -e "  MailHog:     ${BLUE}http://localhost:8025${NC}  (view verification emails)"
echo -e "  Postgres:    ${BLUE}localhost:5432${NC}  (cslate / cslate / cslate_dev)"
echo ""
echo -e "  Dev API key: ${YELLOW}cslate_dev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa${NC}"
echo ""
echo -e "  ${CYAN}Ctrl+C to stop all services${NC}"
echo ""

cleanup() {
  echo ""
  log_step "Stopping API server and worker..."
  kill $API_PID $WORKER_PID 2>/dev/null || true
  log_ok "Done. Docker services still running. To stop: docker compose down"
}
trap cleanup EXIT INT TERM

# Start API server and worker concurrently with prefixed logs
pnpm --filter=@cslate/api dev 2>&1 | sed 's/^/\x1b[34m[api]\x1b[0m /' &
API_PID=$!

pnpm --filter=@cslate/worker dev 2>&1 | sed 's/^/\x1b[35m[worker]\x1b[0m /' &
WORKER_PID=$!

# Wait for API server to be ready
log_step "Waiting for API server..."
until curl -sf http://localhost:3000/health > /dev/null 2>&1; do
  sleep 1
done
log_ok "API server ready — http://localhost:3000"

# Keep running until Ctrl+C
wait $API_PID $WORKER_PID
