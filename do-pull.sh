#!/bin/bash

echo "🚀 Deploying SRB Event Hub to DigitalOcean..."

ssh -tt root@167.71.97.103 << 'EOF'

echo "📂 Navigating to project directory..."
cd /var/www/srb-event-hub || cd /root/srb-event-hub || exit

echo "📥 Pulling latest code from GitHub..."
git pull origin main

echo "📦 Installing dependencies..."
npm install

echo "🏗️ Building Next.js app..."
npm run build

echo "🔁 Restarting app with PM2..."
pm2 reload all || pm2 start npm --name "srb-event-hub" -- start

echo "✅ Deployment complete!"

exit
EOF
