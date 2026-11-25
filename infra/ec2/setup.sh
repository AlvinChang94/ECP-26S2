#!/bin/bash
# What: first-boot setup of the OrderFlow server on Amazon Linux 2023: Node.js, secrets, .env, database, demo data, build, service.
# Who calls it: the EC2 user data in infra/orderflow.yaml (once, as root), with the stack's values in /etc/orderflow/stack.env.
# To extend: anything the server needs at start goes here; changes after the first boot go through infra/ec2/update.sh.
set -euo pipefail

NODE_VERSION=22.15.0
APP_DIR=/opt/orderflow/app
RDS_CA=/etc/orderflow/rds-global-bundle.pem
set -a
# shellcheck disable=SC1091
source /etc/orderflow/stack.env
set +a

echo "== $(date -u +%FT%TZ) OrderFlow setup starts"

# 1. Build tools (better-sqlite3 compiles a small native part during npm ci) and swap space for `next build`.
dnf install -y gcc-c++ make python3 tar xz jq
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# 2. Node.js from nodejs.org, checked against the published checksum.
if ! command -v node >/dev/null || [ "$(node --version)" != "v$NODE_VERSION" ]; then
  cd /tmp
  file="node-v$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/$file"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | grep " $file\$" | sha256sum -c -
  mkdir -p /opt/node && tar -xJf "$file" -C /opt/node --strip-components=1
  ln -sf /opt/node/bin/node /usr/local/bin/node
  ln -sf /opt/node/bin/npm /usr/local/bin/npm
  ln -sf /opt/node/bin/npx /usr/local/bin/npx
fi

# 3. A user without login rights runs the app; it owns the app folder.
id orderflow >/dev/null 2>&1 || useradd --system --create-home --shell /sbin/nologin orderflow
chown -R orderflow:orderflow /opt/orderflow

# 4. The certificate bundle that lets the app check the database's TLS certificate.
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o "$RDS_CA"
chmod 644 "$RDS_CA"

# 5. Secrets from Secrets Manager (the server's role may read exactly these three). Nothing secret is in Git or in the template.
secret() { aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$1" --query SecretString --output text; }
db_json=$(secret "$DB_SECRET_ARN")
db_user=$(echo "$db_json" | jq -r .username)
db_password=$(echo "$db_json" | jq -r .password)
encoded_password=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$db_password")
jobs_secret=$(secret "$JOBS_SECRET_ARN")
approval_secret=$(secret "$APPROVAL_SECRET_ARN")

# 6. The app's settings. Readable by the app's user only.
# DATABASE_URL's ssl parameters are for Prisma's migration tool; the app itself uses DATABASE_SSL with the same certificate bundle.
cat > "$APP_DIR/.env" <<ENV
# Written by infra/ec2/setup.sh on first boot. Values come from the CloudFormation stack and Secrets Manager.
DATABASE_URL="mysql://$db_user:$encoded_password@$DB_HOST:3306/orderflow?sslaccept=strict&sslcert=$RDS_CA"
DATABASE_SSL="true"
AWS_REGION="$AWS_REGION"
STORAGE_BACKEND="s3"
S3_BUCKET="$S3_BUCKET"
NOTIFIER="ses"
SES_FROM_ADDRESS="$SES_FROM_ADDRESS"
SES_TEST_RECIPIENT="$SES_TEST_RECIPIENT"
APP_BASE_URL="$APP_BASE_URL"
APPROVAL_LINK_SECRET="$approval_secret"
JOBS_SECRET="$jobs_secret"
ENV
chown orderflow:orderflow "$APP_DIR/.env" && chmod 600 "$APP_DIR/.env"

# 7. Install, create the tables, load the demo data (first boot only), build.
as_app() { sudo -u orderflow -H env NODE_EXTRA_CA_CERTS="$RDS_CA" PATH="/opt/node/bin:/usr/bin:/bin" bash -c "cd $APP_DIR && $1"; }
as_app "npm ci"
if [ ! -f /etc/orderflow/seeded ]; then
  # Empties the tables and loads the demo scenario. Only on first boot, so later deploys never wipe the data.
  as_app "npm run seed -- --reset-mysql"
  touch /etc/orderflow/seeded
fi
as_app "npm run build"

# 8. The app as a service (starts on boot, restarts if it stops) and the helper commands. Shared with update.sh.
# shellcheck disable=SC1091
source "$APP_DIR/infra/ec2/service.sh"
write_service
install_helpers
systemctl enable --now orderflow

# 9. Wait until the app answers before reporting success to CloudFormation.
if wait_for_app; then
  echo "== $(date -u +%FT%TZ) OrderFlow is running at $APP_BASE_URL"
  exit 0
fi
echo "OrderFlow did not answer on port $APP_PORT. See: journalctl -u orderflow" >&2
exit 1
