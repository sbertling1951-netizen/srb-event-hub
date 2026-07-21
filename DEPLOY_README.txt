FCOC Event Hub – Deployment Instructions

This is a Next.js application.

Deployment:
1. Ensure local changes are committed and pushed to main.
2. Run once, if needed: chmod +x deploy
3. Run: ./deploy

The deploy script validates a clean main branch, builds locally, updates the
production Git checkout, installs dependencies only when package manifests
change, builds remotely, restarts PM2, and verifies the production URL.

For a local-only preflight and build that stops before SSH or remote changes:
DEPLOY_DRY_RUN=1 ./deploy

Environment variables required:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY

Notes:
- This app uses Supabase as the backend
- Node.js environment is required
- This is NOT a static site
