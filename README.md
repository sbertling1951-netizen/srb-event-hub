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
