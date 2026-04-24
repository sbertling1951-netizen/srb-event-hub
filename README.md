# FCOC Event Hub

Starter MVP for a cross-device FCOC event PWA.

## Included in this starter

- Member home dashboard
- Agenda page
- Attendee locator and parking overview
- Activities page with cutoff logic
- Nearby page with Apple Maps and Google Maps links
- Announcements page
- Admin event creation page
- Admin CSV/XLSX registration import preview
- PostgreSQL / Supabase-ready schema
- Basic PWA manifest and service worker registration

## Stack

- Next.js App Router
- TypeScript
- Client-side CSV import with Papa Parse
- Client-side Excel import with xlsx

## How to run

1. Install Node.js 20 or newer.
2. In a terminal, go to this folder.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open `http://localhost:3000`.

## Suggested next production steps

1. Add Supabase and replace mock data with real tables.
2. Add authentication and admin/member roles.
3. Add real activity registration and payment flow.
4. Add map image upload and clickable site assignment tools.
5. Add nearby auto-populate using a Places API plus admin review.
6. Add push notifications and offline caching strategy.

## Notes

This is a solid starter scaffold, not a finished production deployment. The structure is designed so you can extend it into a full event platform for multiple FCOC events.

# SRB Event Hub

SRB Event Hub is a cross-device event management platform designed for rallies, clubs, and multi-day events. It provides both admin tools and a member-facing experience in a single Progressive Web App (PWA).

---

## Core Features

### Member Experience

- Event dashboard and home base
- Agenda with time-based grouping
- Attendee directory and coach locator
- Nearby places with map and directions
- Announcements and updates
- Activities and event participation

### Admin Experience

- Event creation and management
- Attendee import (CSV / Excel)
- Attendee management and check-in
- Parking and site assignment tools
- Agenda builder and scheduling
- Announcements publishing
- Nearby location management
- Reports and exports
- Print support (name tags, coach plates)

### Platform Features

- Supabase-ready database structure
- Progressive Web App (PWA) support
- Mobile-friendly UI
- Offline-ready foundation (service worker)

---

## Technology Stack

- Next.js (App Router)
- TypeScript
- Supabase (PostgreSQL + Auth + Storage)
- Papa Parse (CSV import)
- SheetJS (XLSX import)
- React + React Leaflet (maps)

---

## Getting Started (Local Development)

### 1. Requirements

- Node.js 20+
- npm 10+

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Create a `.env.local` file in the root:

```env
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### 4. Run development server

```bash
npm run dev
```

Open in browser:

```
http://localhost:3000
```

---

## Production Build

```bash
npm run build
npm run start
```

---

## Database Setup

This project is designed to run on Supabase.

Use one of the included schema files:

- `supabase_schema.sql`
- `db/schema.sql`

Apply the schema to your Supabase project before running in production.

---

## Deployment Notes

Before deploying, confirm:

- Environment variables are configured
- Supabase project is connected
- Database schema is applied
- Storage buckets exist
- Build completes without errors

---

## Branding Note

This release is branded as **SRB Event Hub**.

Some internal references may still reflect earlier naming. These do not impact functionality and can be updated in a later branding pass.

---

## Project Status

This application has evolved beyond a simple starter and now represents a functional event management system. Additional polish, security (RLS), and documentation are recommended for production-scale deployments.

---

## Suggested Next Steps

- Implement Supabase Row Level Security (RLS)
- Finalize admin permission model
- Complete branding standardization
- Expand reporting and exports
- Add notification and communication tools
- Harden deployment and backup strategy

---

## Summary

SRB Event Hub is a flexible foundation for managing events, attendees, logistics, and communication in a unified system. It is designed to scale from small rallies to large multi-event organizations.
