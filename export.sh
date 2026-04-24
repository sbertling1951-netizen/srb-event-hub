#!/bin/bash

echo "Creating deployment README..."

cat <<EOF > READ_ME_FIRST.txt
FCOC Event Hub – Deployment Instructions

This is a Next.js application.

Deployment steps:
1. Run: npm install
2. Run: npm run build
3. Run: npm start

Environment variables required:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY

Notes:
- This app uses Supabase as the backend
- Node.js environment is required
- This is NOT a static site
EOF

echo "Creating deployment zip..."

zip -r ~/Desktop/fcoc-event-hub-$(date +%Y%m%d-%H%M).zip . \
-x "node_modules/*" \
".next/*" \
".git/*" \
".env*" \
".DS_Store"

echo "Done!"
echo "Zip saved to Desktop"
