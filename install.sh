#!/usr/bin/env bash
set -e

# -----------------------------------------------------------------------------
# NeMo IMAP - Quick 1-Click Installer for Ubuntu, Debian, AlmaLinux, Rocky, RHEL
# -----------------------------------------------------------------------------

echo "=================================================="
echo "          📬 Installing NeMo IMAP                 "
echo "=================================================="

# Ensure running as root or with sudo
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run as root or with sudo: sudo bash install.sh"
  exit 1
fi

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$INSTALL_DIR"

# 1. Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
else
  echo "❌ Cannot determine OS. /etc/os-release not found."
  exit 1
fi

echo "✔ Detected OS: $PRETTY_NAME ($OS)"

# 2. Install Git, Curl & Node.js 20 if missing
install_node() {
  case "$OS" in
    ubuntu|debian)
      echo "📦 Updating apt packages..."
      apt-get update -y
      apt-get install -y curl git make gcc g++
      if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
        echo "📦 Installing Node.js 20 LTS for Ubuntu/Debian..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
      fi
      ;;
    almalinux|rocky|centos|rhel|fedora)
      echo "📦 Updating dnf packages..."
      dnf install -y curl git make gcc-c++
      if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
        echo "📦 Installing Node.js 20 LTS for AlmaLinux/RHEL..."
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        dnf install -y nodejs
      fi
      ;;
    *)
      echo "⚠️ Unrecognized OS. Attempting with available package manager..."
      if command -v apt-get >/dev/null 2>&1; then
        apt-get update -y && apt-get install -y nodejs npm
      elif command -v dnf >/dev/null 2>&1; then
        dnf install -y nodejs npm
      fi
      ;;
  esac
}

install_node

echo "✔ Node version: $(node -v)"
echo "✔ NPM version:  $(npm -v)"

# 3. Setup .env file
if [ ! -f .env ]; then
  echo "⚙️ Creating .env configuration..."
  RANDOM_PASS=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 12 || echo "nemo_admin_$(date +%s)")
  JWT_SEC=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 32 || echo "jwt_secret_$(date +%s)")
  ENC_KEY=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 32 || echo "enc_key_$(date +%s)")

  cat <<EOF > .env
ADMIN_PASSWORD=${RANDOM_PASS}
JWT_SECRET=${JWT_SEC}
ENCRYPTION_KEY=${ENC_KEY}
PORT=3000
DB_PATH=./data/nemo-imap.db
LOG_LEVEL=info
EOF
  echo "✔ Generated .env with secure random keys."
  SHOW_PASS="$RANDOM_PASS"
else
  echo "✔ Existing .env found. Keeping current credentials."
  SHOW_PASS=$(grep -E '^ADMIN_PASSWORD=' .env | cut -d '=' -f2- || echo "(configured in .env)")
fi

# Ensure data directory exists
mkdir -p data

# 4. Install dependencies and build project
echo "📦 Installing dependencies (npm install)..."
npm install --silent

echo "🔨 Building backend and frontend (npm run build)..."
npm run build

# 5. Open Firewall Port 3000
echo "🛡️ Configuring firewall for port 3000..."
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 3000/tcp || true
  echo "✔ Opened port 3000 in UFW"
elif command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-port=3000/tcp || true
  firewall-cmd --reload || true
  echo "✔ Opened port 3000 in firewalld"
fi

# 6. Create & start systemd service
NODE_BIN=$(command -v node)
SERVICE_FILE="/etc/systemd/system/nemo-imap.service"

echo "⚙️ Creating systemd service ($SERVICE_FILE)..."
cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=NeMo IMAP Mailbox Watcher
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${NODE_BIN} ${INSTALL_DIR}/dist/server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nemo-imap
systemctl restart nemo-imap

# 7. Get public/local IP
SERVER_IP=$(curl -s https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo "=================================================="
echo "          🎉 NeMo IMAP IS RUNNING!                "
echo "=================================================="
echo " URL:             http://${SERVER_IP}:3000"
echo " Local URL:       http://localhost:3000"
echo " Admin Password:  ${SHOW_PASS}"
echo " Service Status:  systemctl status nemo-imap"
echo " View Logs:       journalctl -u nemo-imap -f"
echo " Restart:         systemctl restart nemo-imap"
echo "=================================================="
