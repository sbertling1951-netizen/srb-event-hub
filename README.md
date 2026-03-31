# FCOC Event Hub Starter

This is a starter codebase for the **FCOC Event Hub** PWA concept.

## What is included
- Next.js App Router project
- Member-facing screens for Home, Agenda, Activities, Attendees, and Nearby
- Admin screens for Events, Imports, Activities, and Announcements
- CSV/XLSX import preview using `papaparse` and `xlsx`
- Reusable location card with Apple Maps and Google Maps directions links
- Cutoff-date fields for event and activity planning

## What is not included yet
- Database connection
- Authentication
- Payment processing
- Push notifications
- Real map rendering or site marker placement
- Production import/save APIs

## Recommended next build steps
1. Connect Supabase for auth and storage
2. Convert the sample data in `lib/sample-data.ts` to real database queries
3. Add server actions or API routes for event saving, importing, and activity signup
4. Add a true parking map screen with RV site markers
5. Add role-based admin access

## Local setup
1. Install Node.js 20 or newer
2. Open a terminal in this folder
3. Run:

```bash
npm install
npm run dev
```

4. Open the local URL shown in the terminal

## Suggested CSV columns
- registration_id
- first_name
- last_name
- email
- phone
- member_number
- site_number
- coach_make
- coach_model
- arrival_date
- departure_date
- visibility_opt_in
- activity_selections

## Notes for your club
This starter was shaped around FCOC event operations: agenda updates, attendee lookup, nearby places, tours, parking support, and planning cutoffs.
