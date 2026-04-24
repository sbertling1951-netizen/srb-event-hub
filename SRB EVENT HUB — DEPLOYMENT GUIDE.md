SRB EVENT HUB — DEPLOYMENT GUIDE

This document provides the required steps to deploy SRB Event Hub in a production environment.

---

## DEPLOYMENT OVERVIEW

SRB Event Hub is a Next.js application backed by Supabase (database, auth, storage).

You will need:
• A Supabase project
• Node.js hosting environment (DigitalOcean, VPS, or similar)
• Environment variables configured

---

## STEP 1 — INSTALL DEPENDENCIES

From the project root:

npm install

---

## STEP 2 — CONFIGURE ENVIRONMENT

Create a `.env.local` file:

NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

## Add any additional environment variables required by your deployment.

## STEP 3 — DATABASE SETUP

Apply the schema to Supabase:

• supabase_schema.sql
OR
• db/schema.sql

Verify tables exist:
• events
• attendees
• agenda_items
• announcements
• parking_sites
• nearby tables

---

## STEP 4 — STORAGE SETUP

Create required Supabase storage buckets (example):

• event-assets
• master-maps (if used)

Ensure public access or correct policies are configured.

---

## STEP 5 — BUILD APPLICATION

npm run build

If build fails:
• Check environment variables
• Confirm dependencies installed
• Ensure you are in correct directory

---

## STEP 6 — START APPLICATION

npm run start

Default port:
http://localhost:3000 (or your configured host/port)

---

## OPTIONAL — SERVER DEPLOYMENT (DIGITALOCEAN / VPS)

Typical flow:

1. Upload project to server
2. Install Node.js 20+
3. Run npm install
4. Configure .env.local
5. Run npm run build
6. Run npm run start

Optional:
• Use PM2 for process management
• Use Nginx as reverse proxy
• Configure SSL with Certbot

---

## POST-DEPLOYMENT VALIDATION

Verify:

• Application loads
• Admin login works
• Event selection works
• Attendee import functions
• Reports load correctly
• Member interface loads

---

## COMMON DEPLOYMENT ISSUES

App loads but no data:
→ Wrong Supabase project or schema not applied

Images or assets missing:
→ Storage bucket not configured or wrong URL

Permissions errors:
→ Check Supabase roles and access settings

---

## NOTES

• This is a production-capable deployment package
• Internal naming may still reference legacy labels
• Recommend implementing Supabase RLS before public deployment

---

## SUPPORT

Refer to README.md for full system documentation.
