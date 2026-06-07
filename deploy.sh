#!/bin/bash
set -e

VPS="179.237.66.21"
REMOTE_PATH="/var/www/fleurieux"
SSH="ssh root@$VPS"

echo "=== Build client ==="
cd client && npm run build && cd ..

echo "=== Sync vers VPS ==="
rsync -avz --exclude='node_modules' --exclude='.git' --exclude='server/.env' \
  ./ root@$VPS:$REMOTE_PATH/

echo "=== Install deps serveur sur VPS ==="
$SSH "cd $REMOTE_PATH/server && npm install --production"

echo "=== Nginx ==="
$SSH "cp $REMOTE_PATH/nginx.conf /etc/nginx/sites-available/fleurieux && \
  ln -sf /etc/nginx/sites-available/fleurieux /etc/nginx/sites-enabled/fleurieux && \
  nginx -t && systemctl reload nginx"

echo "=== PM2 ==="
$SSH "cd $REMOTE_PATH && mkdir -p logs && pm2 startOrRestart ecosystem.config.js && pm2 save"

echo "=== Déployé ==="
echo "URL: http://$VPS"
