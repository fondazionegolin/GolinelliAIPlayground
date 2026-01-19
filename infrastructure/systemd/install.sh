#!/bin/bash
# Installation script for EduAI Playground systemd service
# Run with: sudo ./install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="eduai-playground.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_FILE}"

echo "=== EduAI Playground - Systemd Service Installation ==="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "Error: This script must be run as root (use sudo)"
   exit 1
fi

# Copy service file
echo "[1/4] Copying service file to ${SERVICE_PATH}..."
cp "${SCRIPT_DIR}/${SERVICE_FILE}" "${SERVICE_PATH}"
chmod 644 "${SERVICE_PATH}"

# Reload systemd
echo "[2/4] Reloading systemd daemon..."
systemctl daemon-reload

# Enable service
echo "[3/4] Enabling service for boot..."
systemctl enable eduai-playground.service

# Start service
echo "[4/4] Starting service..."
systemctl start eduai-playground.service

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Useful commands:"
echo "  systemctl status eduai-playground    # Check status"
echo "  systemctl stop eduai-playground      # Stop service"
echo "  systemctl start eduai-playground     # Start service"
echo "  systemctl restart eduai-playground   # Restart service"
echo "  journalctl -u eduai-playground -f    # View logs"
echo ""
echo "=== Cloudflare Tunnel Configuration ==="
echo "Add the following to your ~/.cloudflared/config.yml:"
echo ""
echo "  - hostname: playground.golinelli.ai"
echo "    service: http://127.0.0.1:80"
echo "    originRequest:"
echo "      noTLSVerify: true"
echo "      connectTimeout: 30s"
echo "      http2Origin: true"
echo ""
echo "Then restart cloudflared: sudo systemctl restart cloudflared"
