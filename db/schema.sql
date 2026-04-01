create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  location_name text not null,
  address text not null,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  start_date date not null,
  end_date date not null,
  event_code text not null,
  registration_open_at timestamptz,
  registration_close_at timestamptz,
  self_edit_close_at timestamptz,
  cancellation_close_at timestamptz,
  refund_close_at timestamptz,
  planning_lock_at timestamptz,
  status text not null default 'Draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  registration_id text,
  member_number text,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  coach_make text,
  coach_model text,
  arrival_date date,
  departure_date date,
  guest_count integer not null default 0,
  emergency_contact text,
  notes text,
  visibility_level text not null default 'site',
  registration_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table rv_sites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  site_number text not null,
  row_name text,
  section_name text,
  map_x numeric,
  map_y numeric,
  notes text,
  is_overflow boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, site_number)
);

create table attendee_sites (
  id uuid primary key default gen_random_uuid(),
  attendee_id uuid not null references attendees(id) on delete cascade,
  site_id uuid not null references rv_sites(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by text
);

create table agenda_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  title text not null,
  description text,
  category text,
  day_date date not null,
  start_time text not null,
  end_time text not null,
  location_name text not null,
  sort_order integer not null default 0,
  is_updated boolean not null default false,
  updated_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table activities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  title text not null,
  description text,
  category text,
  date date not null,
  start_time text not null,
  end_time text not null,
  meeting_location text not null,
  address text,
  latitude double precision,
  longitude double precision,
  departure_location text,
  capacity integer not null,
  price numeric(10,2) not null default 0,
  guest_allowed boolean not null default false,
  max_guests_per_attendee integer not null default 0,
  signup_open_at timestamptz,
  signup_close_at timestamptz,
  waitlist_close_at timestamptz,
  cancellation_close_at timestamptz,
  refund_close_at timestamptz,
  minimum_attendees integer,
  decision_date date,
  status text not null default 'Draft',
  rv_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table activity_registrations (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  attendee_id uuid not null references attendees(id) on delete cascade,
  guest_count integer not null default 0,
  total_due numeric(10,2) not null default 0,
  payment_status text not null default 'pending',
  registration_status text not null default 'booked',
  registered_at timestamptz not null default now(),
  canceled_at timestamptz,
  checked_in_at timestamptz,
  notes text
);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  title text not null,
  message text not null,
  priority text not null default 'Normal',
  publish_at timestamptz,
  expire_at timestamptz,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nearby_places (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  category text,
  address text,
  phone text,
  website text,
  latitude double precision,
  longitude double precision,
  notes text,
  map_link text,
  rv_note text,
  sort_order integer not null default 0
);
