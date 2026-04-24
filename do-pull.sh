#!/bin/bash

ssh root@167.71.97.103

wowtum-8qaxpi-nopKoq

cd /root/srb-event-hub

echo "Pulling latest code..."
git pull

echo "Installing dependencies..."
npm install

echo "Building app..."
npm run build

echo "Restarting app..."
pm2 restart srb-event-hub

echo "Done."
EOF
