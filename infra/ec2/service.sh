#!/bin/bash
# What: writes the systemd service that runs the app, and installs the helper commands (orderflow-run-jobs, orderflow-update).
# Who calls it: infra/ec2/setup.sh (first boot) and infra/ec2/update.sh (every deploy), so a change here reaches running servers too.
# To extend: the port comes from APP_PORT in /etc/orderflow/stack.env (80 by default: many school and office networks block port 3000).

# Usage: source this file, then call write_service and install_helpers. Expects APP_DIR and RDS_CA to be set.
APP_PORT="${APP_PORT:-80}"

write_service() {
  cat > /etc/systemd/system/orderflow.service <<UNIT
[Unit]
Description=Spectra OrderFlow proof of concept
After=network-online.target

[Service]
User=orderflow
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=NODE_EXTRA_CA_CERTS=$RDS_CA
Environment=PATH=/opt/node/bin:/usr/bin:/bin
# Lets the app (not running as root) listen on port 80, and nothing more.
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ExecStart=/opt/node/bin/npm start -- -p $APP_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
}

install_helpers() {
  install -m 755 "$APP_DIR/infra/ec2/run-jobs.sh" /usr/local/bin/orderflow-run-jobs
  install -m 755 "$APP_DIR/infra/ec2/update.sh" /usr/local/bin/orderflow-update
}

# Waits until the app answers on its port. Returns 1 after five minutes.
wait_for_app() {
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT/sign-in" && return 0
    sleep 5
  done
  return 1
}
