#!/bin/bash

echo "🚀 Deploying SRB Event Hub to DigitalOcean..."

ssh -tt root@167.71.97.103 << 'EOF'
cd /root/srb-event-hub || exit

echo "Pulling latest code..."
git pull origin main

echo "Installing dependencies..."
npm install

echo "Building app..."
npm run build

echo "Restarting app..."
pm2 restart srb-event-hub

echo "Done."
exit
EOF
