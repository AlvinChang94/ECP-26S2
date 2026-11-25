#!/bin/bash
# What: brings the running server up to the latest commit of its branch: fetch, install, apply new database migrations, build, restart.
# Who calls it: the deploy job in .github/workflows/ci.yml (through Systems Manager Run Command), or a person in a Session Manager shell.
# To extend: never seed here. The seed empties the tables; it runs once, on first boot (infra/ec2/setup.sh).
#            Settings in /etc/orderflow/stack.env (APP_PORT, APP_BASE_URL) are applied again on every run.
set -euo pipefail

APP_DIR=/opt/orderflow/app
RDS_CA=/etc/orderflow/rds-global-bundle.pem
# shellcheck disable=SC1091
source /etc/orderflow/stack.env
as_app() { sudo -u orderflow -H env NODE_EXTRA_CA_CERTS="$RDS_CA" PATH="/opt/node/bin:/usr/bin:/bin" bash -c "cd $APP_DIR && $1"; }

echo "== $(date -u +%FT%TZ) updating to the latest $REPO_BRANCH"
as_app "git fetch --quiet origin $REPO_BRANCH && git reset --hard origin/$REPO_BRANCH"
as_app "npm ci"
# Prisma reads DATABASE_URL from the environment; load it from .env for this one command.
as_app "set -a && source .env && set +a && npx prisma migrate deploy --config prisma.mysql.config.ts"
as_app "npm run build"
# The app's public address goes into approval links, so keep it in step with stack.env.
sed -i "s#^APP_BASE_URL=.*#APP_BASE_URL=\"$APP_BASE_URL\"#" "$APP_DIR/.env"
# shellcheck disable=SC1091
source "$APP_DIR/infra/ec2/service.sh"
write_service
install_helpers
systemctl restart orderflow
wait_for_app || { echo "OrderFlow did not answer on port $APP_PORT. See: journalctl -u orderflow" >&2; exit 1; }
echo "== $(date -u +%FT%TZ) done: $(as_app 'git log -1 --format=%h\ %s')"
