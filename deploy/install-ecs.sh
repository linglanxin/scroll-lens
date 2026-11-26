#!/usr/bin/env bash
set -euo pipefail

# Idempotent Ubuntu 22.04+ deployment script for ScrollLens backend
APP_DIR="/opt/scroll-lens"
BACKEND_DIR="${APP_DIR}/backend"
DEPLOY_DIR="${APP_DIR}/deploy"
SERVICE_USER="www-data"

echo "==> Checking Python 3.10+..."
PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  echo "Error: ${PYTHON_BIN} not found. Install python3 and python3-venv first." >&2
  exit 1
fi

"${PYTHON_BIN}" -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10+ required"'

if [ ! -d "${BACKEND_DIR}" ]; then
  echo "Error: Expected repository at ${APP_DIR}." >&2
  exit 1
fi

echo "==> Setting up Python virtual environment..."
if [ ! -d "${BACKEND_DIR}/.venv" ]; then
  "${PYTHON_BIN}" -m venv "${BACKEND_DIR}/.venv"
fi

"${BACKEND_DIR}/.venv/bin/pip" install --upgrade pip
"${BACKEND_DIR}/.venv/bin/pip" install --no-cache-dir "${BACKEND_DIR}"

echo "==> Checking deploy/.env..."
if [ ! -f "${DEPLOY_DIR}/.env" ]; then
  cp "${DEPLOY_DIR}/.env.example" "${DEPLOY_DIR}/.env"
  SECRET=$("${BACKEND_DIR}/.venv/bin/python" -c "import secrets; print(secrets.token_urlsafe(48))")
  sed -i "s|APP_SECRET_KEY=replace-with-a-long-random-secret-key|APP_SECRET_KEY=${SECRET}|" "${DEPLOY_DIR}/.env"
  echo "Generated new APP_SECRET_KEY in ${DEPLOY_DIR}/.env"
fi

mkdir -p "${BACKEND_DIR}/data"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${BACKEND_DIR}/data" "${DEPLOY_DIR}/.env"
chmod 600 "${DEPLOY_DIR}/.env"

echo "==> Installing systemd service..."
cp "${DEPLOY_DIR}/scroll-lens.service" /etc/systemd/system/scroll-lens.service
systemctl daemon-reload
systemctl enable scroll-lens
systemctl restart scroll-lens

sleep 2
echo "==> Verifying local health endpoint..."
curl -fsS http://127.0.0.1:8000/api/v1/health
echo ""
echo "ScrollLens deployment complete."
