#!/bin/bash

echo "🚀 Deploying to DigitalOcean..."

ssh root@167.71.97.103 << 'EOF'
cd ~/srb-event-hub || exit

echo "📥 Pulling latest code..."
git pull origin main

echo "📦 Installing..."
npm install

echo "🏗️ Building..."
npm run build

echo "🔁 Restarting PM2..."
pm2 restart srb-event-hub || pm2 start npm --name "srb-event-hub" -- start

echo "🔁 Restarting nginx..."
systemctl restart nginx

echo "✅ Done."
EOF
