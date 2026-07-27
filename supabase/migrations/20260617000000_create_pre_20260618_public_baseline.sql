BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  organization_name text NOT NULL,
  display_name text NOT NULL,
  app_title text NOT NULL,
  app_tagline text,
  logo_url text,
  favicon_url text,
  primary_color text,
  secondary_color text,
  accent_color text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text,
  start_date date,
  end_date date,
  registration_close_at timestamp,
  created_at timestamp DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  is_master_map boolean NOT NULL DEFAULT false,
  master_map_id uuid,
  map_image_url text,
  coach_map_open_scale numeric DEFAULT 0.6,
  parking_map_open_scale numeric DEFAULT 0.6,
  locations_map_open_scale numeric DEFAULT 0.6,
  timezone text,
  venue_name text,
  street_address text,
  city_state text,
  self_edit_close_at timestamptz,
  cancellation_deadline timestamptz,
  refund_deadline timestamptz,
  planning_lock_at timestamptz,
  event_code text,
  status text DEFAULT 'Draft',
  visible_to_members boolean NOT NULL DEFAULT false,
  registration_open boolean NOT NULL DEFAULT false,
  show_draft_agenda boolean NOT NULL DEFAULT false,
  show_draft_activities boolean NOT NULL DEFAULT false,
  member_note text,
  nearby_area_id uuid,
  lat numeric,
  lng numeric,
  selected_nearby_master_id uuid,
  selected_nearby_area_id uuid,
  assigned_agenda_template_id uuid,
  short_name text
);

CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text,
  is_active boolean NOT NULL DEFAULT true,
  is_super_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  privilege_group text NOT NULL DEFAULT 'event_admin' CHECK (
    privilege_group IN ('super_admin', 'event_admin', 'checkin', 'parking', 'content_admin', 'read_only')
  ),
  last_event_id uuid
);

CREATE TABLE IF NOT EXISTS public.attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid,
  membership_number text,
  pilot_first text,
  pilot_last text,
  copilot_first text,
  copilot_last text,
  email text,
  phone text,
  coach_make text,
  coach_model text,
  coach_length text,
  first_time boolean DEFAULT false,
  volunteer boolean DEFAULT false,
  handicap_parking boolean DEFAULT false,
  assigned_site text,
  actual_site text,
  created_at timestamp DEFAULT now(),
  entry_id text,
  share_with_attendees boolean NOT NULL DEFAULT false,
  share_location boolean DEFAULT true,
  arrival_status text DEFAULT 'not_arrived',
  checked_in_at timestamptz,
  city text,
  state text,
  has_arrived boolean DEFAULT false,
  nickname text,
  primary_phone text,
  cell_phone text,
  wants_to_volunteer boolean DEFAULT false,
  is_first_timer boolean DEFAULT false,
  coach_manufacturer text,
  special_events_raw text,
  raw_import jsonb,
  copilot_nickname text,
  is_active boolean NOT NULL DEFAULT true,
  inactive_reason text,
  participant_type text DEFAULT 'attendee',
  source_type text DEFAULT 'imported',
  include_in_headcount boolean DEFAULT true,
  needs_name_tag boolean DEFAULT true,
  needs_coach_plate boolean DEFAULT true,
  needs_parking boolean DEFAULT true,
  notes text,
  data_status text DEFAULT 'pending',
  vendor_master_id uuid,
  vendor_assigned_event_id uuid,
  participant_capacity integer,
  auth_user_id uuid,
  copilot_email text,
  copilot_cell_phone text,
  registration_status text NOT NULL DEFAULT 'registered',
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancellation_reason text,
  last_login_at timestamptz,
  login_count integer NOT NULL DEFAULT 0,
  CONSTRAINT attendees_event_id_email_unique UNIQUE (event_id, email)
);

CREATE TABLE IF NOT EXISTS public.attendee_household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  attendee_id uuid NOT NULL,
  entry_id text,
  person_role text NOT NULL CHECK (person_role IN ('pilot', 'copilot', 'additional')),
  first_name text,
  last_name text,
  nickname text,
  display_name text,
  age_text text,
  sort_order integer DEFAULT 0,
  raw_text text,
  created_at timestamptz DEFAULT now(),
  email text,
  participant_status text DEFAULT 'identified',
  registered_at timestamptz,
  auth_user_id uuid,
  cell_phone text,
  CONSTRAINT attendee_household_members_attendee_role_unique UNIQUE (attendee_id, person_role)
);

ALTER TABLE public.attendees
  ADD CONSTRAINT attendees_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.attendee_household_members
  ADD CONSTRAINT attendee_household_members_attendee_id_fkey
  FOREIGN KEY (attendee_id) REFERENCES public.attendees(id) ON DELETE CASCADE;

ALTER TABLE public.attendee_household_members
  ADD CONSTRAINT attendee_household_members_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS attendees_event_entry_id_idx
  ON public.attendees (event_id, entry_id);

CREATE INDEX IF NOT EXISTS attendees_event_id_is_active_idx
  ON public.attendees (event_id, is_active);

CREATE INDEX IF NOT EXISTS attendees_event_participant_type_idx
  ON public.attendees (event_id, participant_type);

CREATE INDEX IF NOT EXISTS attendee_household_members_attendee_id_idx
  ON public.attendee_household_members (attendee_id);

CREATE INDEX IF NOT EXISTS attendee_household_members_event_id_idx
  ON public.attendee_household_members (event_id);

CREATE INDEX IF NOT EXISTS attendee_household_members_entry_id_idx
  ON public.attendee_household_members (entry_id);

CREATE TABLE IF NOT EXISTS "public"."activities" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid",
  "name" "text",
  "description" "text",
  "capacity" integer,
  "location" "text",
  "activity_time" timestamp without time zone,
  "created_at" timestamp without time zone DEFAULT "now"(),
  "status" "text" DEFAULT 'open'::"text",
  "cutoff_text" "text",
  "price_text" "text",
  "seats_left" integer,
  "sort_order" integer DEFAULT 100,
  "is_published" boolean DEFAULT true,
  "updated_at" timestamp with time zone DEFAULT "now"(),
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "title" "text",
  CONSTRAINT "activities_status_check" CHECK ((("status") = ANY (ARRAY['open'::"text", 'waitlist'::"text", 'closed'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."activity_registrations" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "attendee_id" "uuid",
  "activity_id" "uuid",
  "quantity" integer DEFAULT 1,
  "created_at" timestamp without time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."admin_event_access" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "admin_user_id" "uuid" NOT NULL,
  "event_id" "uuid" NOT NULL,
  "role" "text" NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "admin_event_access_role_check" CHECK ((("role") = ANY (ARRAY['event_admin'::"text", 'content_admin'::"text", 'parking_admin'::"text", 'view_only'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."admin_event_permissions" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "admin_event_access_id" "uuid" NOT NULL,
  "permission_key" "text" NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."admin_permission_audit" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "admin_user_id" "uuid",
  "admin_email" "text",
  "privilege_group" "text",
  "permission_key" "text",
  "old_value" boolean,
  "new_value" boolean,
  "changed_at" timestamp with time zone DEFAULT "now"(),
  "action_id" "uuid"
);

CREATE TABLE IF NOT EXISTS "public"."admin_permission_presets" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "name" "text",
  "config" "jsonb",
  "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."admin_permissions" (
  "admin_user_id" "uuid" NOT NULL,
  "can_manage_admins" boolean DEFAULT false NOT NULL,
  "can_manage_events" boolean DEFAULT false NOT NULL,
  "can_import_attendees" boolean DEFAULT false NOT NULL,
  "can_edit_attendees" boolean DEFAULT false NOT NULL,
  "can_mark_arrived" boolean DEFAULT false NOT NULL,
  "can_assign_parking" boolean DEFAULT false NOT NULL,
  "can_manage_agenda" boolean DEFAULT false NOT NULL,
  "can_manage_announcements" boolean DEFAULT false NOT NULL,
  "can_manage_nearby" boolean DEFAULT false NOT NULL,
  "can_view_reports" boolean DEFAULT true NOT NULL,
  "can_export_reports" boolean DEFAULT false NOT NULL,
  "can_manage_master_maps" boolean DEFAULT false NOT NULL,
  "can_manage_master_nearby" boolean DEFAULT false NOT NULL,
  "can_manage_settings" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "can_manage_event_admins" boolean DEFAULT false NOT NULL,
  "can_manage_print_settings" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."admin_privilege_group_permissions" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "privilege_group" "text" NOT NULL,
  "permission_key" "text" NOT NULL,
  "is_enabled" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."agenda_categories" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "name" "text" NOT NULL,
  "color" "text" DEFAULT '#2563eb'::"text" NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "sort_order" integer DEFAULT 100 NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."agenda_items" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid" NOT NULL,
  "title" "text" NOT NULL,
  "description" "text",
  "location" "text",
  "category" "text",
  "start_time" time without time zone NOT NULL,
  "end_time" time without time zone,
  "sort_order" integer DEFAULT 0,
  "is_published" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT "now"(),
  "import_key" "text",
  "source" "text" DEFAULT 'manual'::"text",
  "external_id" "text",
  "category_id" "uuid",
  "speaker" "text",
  "agenda_date" "date",
  "color" "text"
);

CREATE TABLE IF NOT EXISTS "public"."agenda_template_categories" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "template_set_id" "uuid" NOT NULL,
  "name" "text" NOT NULL,
  "color" "text" DEFAULT '#2563eb'::"text" NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."agenda_template_items" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "template_set_id" "uuid" NOT NULL,
  "template_category_id" "uuid",
  "title" "text" NOT NULL,
  "description" "text",
  "location" "text",
  "day_offset" integer,
  "start_time_template" "text",
  "end_time_template" "text",
  "is_all_day" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "template_id" "uuid",
  "external_id" "text",
  "speaker" "text",
  "category" "text",
  "color" "text",
  "agenda_date" "date",
  "start_time" time without time zone,
  "end_time" time without time zone,
  "is_published" boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS "public"."agenda_template_sets" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "name" "text" NOT NULL,
  "description" "text",
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."agenda_templates" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "name" "text" NOT NULL,
  "description" "text",
  "status" "text" DEFAULT 'active'::"text" NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."announcements" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid",
  "title" "text",
  "message" "text",
  "created_at" timestamp with time zone DEFAULT "now"(),
  "body" "text",
  "is_important" boolean DEFAULT false,
  "is_published" boolean DEFAULT true,
  "published_at" timestamp with time zone DEFAULT "now"(),
  "is_pinned" boolean DEFAULT false,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "published" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "category" "text",
  "priority" "text",
  "expires_at" timestamp with time zone,
  "type" "text" DEFAULT 'info'::"text" NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "publish_at" timestamp with time zone,
  "expire_at" timestamp with time zone,
  CONSTRAINT "announcements_type_check" CHECK ((("type") = ANY (ARRAY['info'::"text", 'urgent'::"text", 'schedule'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."area_groups" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "name" "text" NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."attendee_activities" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid" NOT NULL,
  "entry_id" "text" NOT NULL,
  "attendee_email" "text",
  "activity_name" "text" NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "price" numeric(10,2),
  "raw_name" "text",
  "source_column_prefix" "text" NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."engagement_activity" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid",
  "attendee_id" "uuid",
  "activity_type" "text" NOT NULL,
  "activity_time" timestamp with time zone DEFAULT "now"() NOT NULL,
  "details" "jsonb"
);

CREATE TABLE IF NOT EXISTS "public"."event_import_rows" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid" NOT NULL,
  "import_type" "text" DEFAULT 'attendee_roster'::"text" NOT NULL,
  "source_filename" "text",
  "row_number" integer,
  "entry_id" "text",
  "email" "text",
  "membership_number" "text",
  "pilot_first" "text",
  "pilot_last" "text",
  "pilot_badge_nickname" "text",
  "copilot_first" "text",
  "copilot_last" "text",
  "copilot_badge_nickname" "text",
  "additional_attendees" "text",
  "city" "text",
  "state" "text",
  "primary_phone" "text",
  "cell_phone" "text",
  "share_with_attendees" boolean DEFAULT false,
  "wants_to_volunteer" boolean DEFAULT false,
  "is_first_timer" boolean DEFAULT false,
  "coach_manufacturer" "text",
  "coach_model" "text",
  "special_events_raw" "text",
  "raw_import" "jsonb",
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "participant_type" "text" DEFAULT 'attendee'::"text",
  "source_type" "text" DEFAULT 'imported'::"text",
  "include_in_headcount" boolean DEFAULT true,
  "needs_name_tag" boolean DEFAULT true,
  "needs_coach_plate" boolean DEFAULT true,
  "needs_parking" boolean DEFAULT true,
  "notes" "text"
);

CREATE TABLE IF NOT EXISTS "public"."event_locations" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid" NOT NULL,
  "name" "text" NOT NULL,
  "description" "text",
  "category" "text",
  "map_x" numeric NOT NULL,
  "map_y" numeric NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"(),
  "priority" integer DEFAULT 100
);

CREATE TABLE IF NOT EXISTS "public"."event_map_settings" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid" NOT NULL,
  "selected_master_map_id" "uuid",
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "assigned_nearby_area_id" "uuid"
);

CREATE TABLE IF NOT EXISTS "public"."event_nearby_places" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid" NOT NULL,
  "master_place_id" "uuid",
  "name" "text" NOT NULL,
  "address" "text",
  "phone" "text",
  "website" "text",
  "category" "text",
  "notes" "text",
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_hidden" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "distance_miles" numeric,
  "location_code" "text",
  "lat" numeric,
  "lng" numeric
);

CREATE TABLE IF NOT EXISTS "public"."event_photo_metadata" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "photo_id" "uuid" NOT NULL,
  "original_filename" "text",
  "mime_type" "text",
  "file_size" bigint,
  "image_width" integer,
  "image_height" integer,
  "camera_make" "text",
  "camera_model" "text",
  "photo_taken_at" timestamp with time zone,
  "gps_latitude" numeric,
  "gps_longitude" numeric,
  "raw_exif_json" "jsonb",
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."event_photos" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid" NOT NULL,
  "attendee_id" "uuid",
  "photographer_name_snapshot" "text",
  "storage_path" "text" NOT NULL,
  "thumbnail_path" "text",
  "photo_status" "text" DEFAULT 'pending'::"text" NOT NULL,
  "caption_status" "text" DEFAULT 'pending'::"text" NOT NULL,
  "member_caption" "text",
  "admin_caption" "text",
  "show_caption" boolean DEFAULT false NOT NULL,
  "is_featured" boolean DEFAULT false NOT NULL,
  "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "photo_approved_at" timestamp with time zone,
  "photo_approved_by" "text",
  "caption_approved_at" timestamp with time zone,
  "caption_approved_by" "text",
  "first_shown_at" timestamp with time zone,
  "last_shown_at" timestamp with time zone,
  "times_shown" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "featured_level" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."event_print_settings" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid" NOT NULL,
  "name_tag_bg_url" "text",
  "coach_plate_bg_url" "text",
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."event_staff" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid" NOT NULL,
  "name" "text" NOT NULL,
  "role" "text",
  "phone" "text",
  "email" "text",
  "notes" "text",
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."event_vendors" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid",
  "vendor_id" "uuid",
  "is_featured" boolean DEFAULT false,
  "display_order" integer DEFAULT 100,
  "signup_url" "text",
  "event_note" "text",
  "is_visible_to_members" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT "now"(),
  "action_type" "text" DEFAULT 'service_request'::"text" NOT NULL,
  "booth_location" "text",
  "show_on_member_dashboard" boolean DEFAULT true NOT NULL,
  "allow_service_requests" boolean DEFAULT false NOT NULL,
  "status" "text" DEFAULT 'assigned'::"text" NOT NULL,
  "notes" "text",
  CONSTRAINT "event_vendors_action_type_check" CHECK ((("action_type") = ANY (ARRAY['service_request'::"text", 'external_signup'::"text", 'info_only'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."imports" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid",
  "file_name" "text",
  "rows_imported" integer,
  "imported_at" timestamp without time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."master_map_locations" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "master_map_id" "uuid" NOT NULL,
  "name" "text" NOT NULL,
  "category" "text",
  "description" "text",
  "map_x" numeric NOT NULL,
  "map_y" numeric NOT NULL,
  "icon_name" "text",
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."master_map_sites" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "master_map_id" "uuid" NOT NULL,
  "site_number" "text" NOT NULL,
  "display_label" "text",
  "map_x" numeric,
  "map_y" numeric,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."master_map_sites_backup" (
  "backup_id" "uuid" DEFAULT "gen_random_uuid"(),
  "backed_up_at" timestamp with time zone DEFAULT "now"(),
  "original_id" "uuid",
  "master_map_id" "uuid",
  "site_number" "text",
  "display_label" "text",
  "map_x" numeric,
  "map_y" numeric
);

CREATE TABLE IF NOT EXISTS "public"."master_maps" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "name" "text" NOT NULL,
  "park_name" "text",
  "location" "text",
  "map_image_path" "text",
  "map_image_url" "text",
  "status" "text" DEFAULT 'draft'::"text" NOT NULL,
  "is_read_only" boolean DEFAULT false NOT NULL,
  "site_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "is_locked" boolean DEFAULT false,
  "area_group_id" "uuid",
  "map_group" "text",
  CONSTRAINT "master_maps_status_check" CHECK ((("status") = ANY (ARRAY['draft'::"text", 'published'::"text", 'archived'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."nearby_area_templates" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "name" "text" NOT NULL,
  "description" "text",
  "city" "text",
  "state" "text",
  "country" "text" DEFAULT 'USA'::"text",
  "search_query" "text",
  "google_query_type" "text" DEFAULT 'nearby'::"text",
  "latitude" numeric,
  "longitude" numeric,
  "radius_meters" integer DEFAULT 16093,
  "is_active" boolean DEFAULT true,
  "created_by" "uuid",
  "created_at" timestamp with time zone DEFAULT "now"(),
  "updated_at" timestamp with time zone DEFAULT "now"(),
  "google_query" "text",
  "google_radius_miles" numeric,
  "google_custom_search" "text",
  "google_search_city" "text",
  "google_search_state" "text",
  "google_last_run" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "public"."nearby_areas" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "name" "text" NOT NULL,
  "description" "text",
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."nearby_categories" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "name" "text" NOT NULL,
  "sort_order" integer DEFAULT 100,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."nearby_event" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid",
  "master_id" "uuid",
  "name" "text" NOT NULL,
  "address" "text",
  "category" "text",
  "description" "text",
  "lat" numeric,
  "lng" numeric,
  "link" "text",
  "created_at" timestamp without time zone DEFAULT "now"(),
  "area_id" "uuid",
  "phone" "text",
  "hours" "text",
  "location_code" "text"
);

CREATE TABLE IF NOT EXISTS "public"."nearby_master" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "name" "text" NOT NULL,
  "address" "text",
  "category" "text",
  "description" "text",
  "lat" numeric,
  "lng" numeric,
  "link" "text",
  "created_at" timestamp without time zone DEFAULT "now"(),
  "area_id" "uuid",
  "phone" "text",
  "hours" "text",
  "status" "text" DEFAULT 'active'::"text" NOT NULL,
  "location_code" "text",
  CONSTRAINT "nearby_master_status_check" CHECK ((("status") = ANY (ARRAY['active'::"text", 'hidden'::"text", 'archived'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."nearby_master_places" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "area_id" "uuid" NOT NULL,
  "name" "text" NOT NULL,
  "address" "text",
  "phone" "text",
  "website" "text",
  "category" "text",
  "notes" "text",
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "distance_miles" numeric,
  "location_code" "text"
);

CREATE TABLE IF NOT EXISTS "public"."nearby_places" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid" NOT NULL,
  "name" "text" NOT NULL,
  "category" "text",
  "description" "text",
  "address" "text",
  "lat" numeric,
  "lng" numeric,
  "link" "text",
  "created_at" timestamp without time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."nearby_template_places" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "template_id" "uuid" NOT NULL,
  "name" "text" NOT NULL,
  "google_place_id" "text",
  "category" "text",
  "address" "text",
  "city" "text",
  "state" "text",
  "postal_code" "text",
  "latitude" numeric,
  "longitude" numeric,
  "phone" "text",
  "website" "text",
  "rating" numeric,
  "user_ratings_total" integer,
  "photo_reference" "text",
  "is_active" boolean DEFAULT true,
  "source_updated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT "now"(),
  "updated_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."parking_sites" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid",
  "site_number" "text",
  "notes" "text",
  "map_x" numeric,
  "map_y" numeric,
  "assigned_attendee_id" "uuid",
  "display_label" "text",
  "map_image_url" "text",
  "master_site_id" "uuid"
);

CREATE TABLE IF NOT EXISTS "public"."participant_activity_log" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid",
  "attendee_id" "uuid",
  "email" "text",
  "activity_type" "text" DEFAULT 'login'::"text" NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "details" "jsonb"
);

CREATE TABLE IF NOT EXISTS "public"."photo_display_log" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "photo_id" "uuid" NOT NULL,
  "event_id" "uuid" NOT NULL,
  "slideshow_session_id" "text",
  "shown_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."shared_area_locations" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "area_group_id" "uuid" NOT NULL,
  "name" "text" NOT NULL,
  "category" "text",
  "address_line1" "text",
  "address_line2" "text",
  "city" "text",
  "state" "text",
  "postal_code" "text",
  "phone" "text",
  "website" "text",
  "hours" "text",
  "notes" "text",
  "priority" integer DEFAULT 100 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."test_connection" (
  "id" integer NOT NULL,
  "message" "text"
);

CREATE SEQUENCE IF NOT EXISTS "public"."test_connection_id_seq"
  AS integer
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

ALTER SEQUENCE "public"."test_connection_id_seq" OWNED BY "public"."test_connection"."id";

CREATE TABLE IF NOT EXISTS "public"."user_roles" (
  "id" "uuid" NOT NULL,
  "role" "text" NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"(),
  CONSTRAINT "user_roles_role_check" CHECK ((("role") = ANY (ARRAY['attendee'::"text", 'volunteer'::"text", 'host'::"text", 'super_admin'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."validation_rules" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "field_name" "text" NOT NULL,
  "rule_type" "text" NOT NULL,
  "rule_value" "text",
  "message" "text" NOT NULL,
  "severity" "text" DEFAULT 'error'::"text" NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "priority" integer DEFAULT 100 NOT NULL,
  "applies_to_event_id" "uuid",
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."vendor_service_requests" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "event_id" "uuid",
  "vendor_id" "uuid",
  "service_id" "uuid",
  "attendee_id" "uuid",
  "requester_name" "text",
  "requester_email" "text",
  "requester_phone" "text",
  "site_number" "text",
  "coach_info" "text",
  "requested_service" "text",
  "request_notes" "text",
  "preferred_response_method" "text",
  "request_status" "text" DEFAULT 'new'::"text",
  "created_at" timestamp with time zone DEFAULT "now"(),
  "guest_count" integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "public"."vendor_services" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "vendor_id" "uuid",
  "service_name" "text" NOT NULL,
  "service_description" "text",
  "service_category" "text",
  "price_note" "text",
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."vendors" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "business_name" "text",
  "contact_name" "text",
  "email" "text",
  "phone" "text",
  "website" "text",
  "logo_url" "text",
  "business_description" "text",
  "preferred_contact_method" "text" DEFAULT 'email'::"text",
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT "now"(),
  "access_token" "text",
  "access_token_expires_at" timestamp with time zone,
  "vendor_portal_enabled" boolean DEFAULT true NOT NULL,
  "name" "text" NOT NULL,
  "services" "text",
  "notes" "text"
);

ALTER TABLE ONLY "public"."activities"
  ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."activity_registrations"
  ADD CONSTRAINT "activity_registrations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."admin_event_access"
  ADD CONSTRAINT "admin_event_access_admin_user_id_event_id_role_key" UNIQUE ("admin_user_id", "event_id", "role");

ALTER TABLE ONLY "public"."admin_event_access"
  ADD CONSTRAINT "admin_event_access_event_id_admin_user_id_key" UNIQUE ("event_id", "admin_user_id");

ALTER TABLE ONLY "public"."admin_event_access"
  ADD CONSTRAINT "admin_event_access_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."admin_event_permissions"
  ADD CONSTRAINT "admin_event_permissions_access_permission_key_unique" UNIQUE ("admin_event_access_id", "permission_key");

ALTER TABLE ONLY "public"."admin_event_permissions"
  ADD CONSTRAINT "admin_event_permissions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."admin_permission_audit"
  ADD CONSTRAINT "admin_permission_audit_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."admin_permission_presets"
  ADD CONSTRAINT "admin_permission_presets_name_key" UNIQUE ("name");

ALTER TABLE ONLY "public"."admin_permission_presets"
  ADD CONSTRAINT "admin_permission_presets_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."admin_permissions"
  ADD CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("admin_user_id");

ALTER TABLE ONLY "public"."admin_privilege_group_permissions"
  ADD CONSTRAINT "admin_privilege_group_permissions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."admin_privilege_group_permissions"
  ADD CONSTRAINT "admin_privilege_group_permissions_unique" UNIQUE ("privilege_group", "permission_key");

ALTER TABLE ONLY "public"."agenda_categories"
  ADD CONSTRAINT "agenda_categories_name_key" UNIQUE ("name");

ALTER TABLE ONLY "public"."agenda_categories"
  ADD CONSTRAINT "agenda_categories_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."agenda_items"
  ADD CONSTRAINT "agenda_items_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."agenda_template_categories"
  ADD CONSTRAINT "agenda_template_categories_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."agenda_template_items"
  ADD CONSTRAINT "agenda_template_items_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."agenda_template_sets"
  ADD CONSTRAINT "agenda_template_sets_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."agenda_templates"
  ADD CONSTRAINT "agenda_templates_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."announcements"
  ADD CONSTRAINT "announcements_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."area_groups"
  ADD CONSTRAINT "area_groups_name_key" UNIQUE ("name");

ALTER TABLE ONLY "public"."area_groups"
  ADD CONSTRAINT "area_groups_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."attendee_activities"
  ADD CONSTRAINT "attendee_activities_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."engagement_activity"
  ADD CONSTRAINT "engagement_activity_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_import_rows"
  ADD CONSTRAINT "event_import_rows_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_locations"
  ADD CONSTRAINT "event_locations_event_id_name_key" UNIQUE ("event_id", "name");

ALTER TABLE ONLY "public"."event_locations"
  ADD CONSTRAINT "event_locations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_map_settings"
  ADD CONSTRAINT "event_map_settings_event_id_key" UNIQUE ("event_id");

ALTER TABLE ONLY "public"."event_map_settings"
  ADD CONSTRAINT "event_map_settings_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_nearby_places"
  ADD CONSTRAINT "event_nearby_places_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_photo_metadata"
  ADD CONSTRAINT "event_photo_metadata_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_photos"
  ADD CONSTRAINT "event_photos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_print_settings"
  ADD CONSTRAINT "event_print_settings_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_staff"
  ADD CONSTRAINT "event_staff_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."event_vendors"
  ADD CONSTRAINT "event_vendors_event_id_vendor_id_key" UNIQUE ("event_id", "vendor_id");

ALTER TABLE ONLY "public"."event_vendors"
  ADD CONSTRAINT "event_vendors_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."imports"
  ADD CONSTRAINT "imports_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."master_map_locations"
  ADD CONSTRAINT "master_map_locations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."master_map_sites"
  ADD CONSTRAINT "master_map_sites_master_map_id_site_number_key" UNIQUE ("master_map_id", "site_number");

ALTER TABLE ONLY "public"."master_map_sites"
  ADD CONSTRAINT "master_map_sites_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."master_maps"
  ADD CONSTRAINT "master_maps_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."nearby_area_templates"
  ADD CONSTRAINT "nearby_area_templates_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."nearby_areas"
  ADD CONSTRAINT "nearby_areas_name_key" UNIQUE ("name");

ALTER TABLE ONLY "public"."nearby_areas"
  ADD CONSTRAINT "nearby_areas_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."nearby_categories"
  ADD CONSTRAINT "nearby_categories_name_key" UNIQUE ("name");

ALTER TABLE ONLY "public"."nearby_categories"
  ADD CONSTRAINT "nearby_categories_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."nearby_event"
  ADD CONSTRAINT "nearby_event_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."nearby_master"
  ADD CONSTRAINT "nearby_master_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."nearby_master_places"
  ADD CONSTRAINT "nearby_master_places_area_name_unique" UNIQUE ("area_id", "name");

ALTER TABLE ONLY "public"."nearby_master_places"
  ADD CONSTRAINT "nearby_master_places_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."nearby_places"
  ADD CONSTRAINT "nearby_places_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."nearby_template_places"
  ADD CONSTRAINT "nearby_template_places_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."parking_sites"
  ADD CONSTRAINT "parking_sites_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."participant_activity_log"
  ADD CONSTRAINT "participant_activity_log_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."photo_display_log"
  ADD CONSTRAINT "photo_display_log_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."shared_area_locations"
  ADD CONSTRAINT "shared_area_locations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."test_connection"
  ADD CONSTRAINT "test_connection_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."user_roles"
  ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."validation_rules"
  ADD CONSTRAINT "validation_rules_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."vendor_service_requests"
  ADD CONSTRAINT "vendor_service_requests_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."vendor_services"
  ADD CONSTRAINT "vendor_services_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."vendors"
  ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("id");

CREATE INDEX "admin_event_permissions_access_idx" ON "public"."admin_event_permissions" USING "btree" ("admin_event_access_id");

CREATE INDEX "agenda_items_category_id_idx" ON "public"."agenda_items" USING "btree" ("category_id");

CREATE UNIQUE INDEX "agenda_items_event_id_external_id_unique" ON "public"."agenda_items" USING "btree" ("event_id", "external_id");

CREATE INDEX "agenda_template_categories_set_idx" ON "public"."agenda_template_categories" USING "btree" ("template_set_id");

CREATE UNIQUE INDEX "agenda_template_categories_set_name_unique" ON "public"."agenda_template_categories" USING "btree" ("template_set_id", lower(TRIM(BOTH FROM "name")));

CREATE INDEX "agenda_template_items_category_idx" ON "public"."agenda_template_items" USING "btree" ("template_category_id");

CREATE INDEX "agenda_template_items_set_idx" ON "public"."agenda_template_items" USING "btree" ("template_set_id");

CREATE UNIQUE INDEX "agenda_unique_external" ON "public"."agenda_items" USING "btree" ("event_id", "external_id") WHERE ("external_id" IS NOT NULL);

CREATE INDEX "announcements_created_at_idx" ON "public"."announcements" USING "btree" ("created_at" DESC);

CREATE INDEX "announcements_event_id_idx" ON "public"."announcements" USING "btree" ("event_id");

CREATE INDEX "announcements_event_pinned_idx" ON "public"."announcements" USING "btree" ("event_id", "is_pinned" DESC, "created_at" DESC);

CREATE INDEX "announcements_event_published_idx" ON "public"."announcements" USING "btree" ("event_id", "published");

CREATE INDEX "announcements_pinned_idx" ON "public"."announcements" USING "btree" ("is_pinned" DESC);

CREATE UNIQUE INDEX "attendee_activities_event_entry_prefix_unique" ON "public"."attendee_activities" USING "btree" ("event_id", "entry_id", "source_column_prefix");

CREATE INDEX "event_import_rows_entry_id_idx" ON "public"."event_import_rows" USING "btree" ("entry_id");

CREATE UNIQUE INDEX "event_import_rows_event_entry_unique" ON "public"."event_import_rows" USING "btree" ("event_id", "import_type", "entry_id");

CREATE INDEX "event_import_rows_event_id_idx" ON "public"."event_import_rows" USING "btree" ("event_id");

CREATE INDEX "event_import_rows_event_participant_type_idx" ON "public"."event_import_rows" USING "btree" ("event_id", "participant_type");

CREATE INDEX "event_nearby_places_event_id_idx" ON "public"."event_nearby_places" USING "btree" ("event_id");

CREATE INDEX "event_nearby_places_master_place_id_idx" ON "public"."event_nearby_places" USING "btree" ("master_place_id");

CREATE UNIQUE INDEX "event_print_settings_event_id_unique" ON "public"."event_print_settings" USING "btree" ("event_id");

CREATE INDEX "event_staff_event_id_idx" ON "public"."event_staff" USING "btree" ("event_id");

CREATE INDEX "event_staff_event_id_sort_order_idx" ON "public"."event_staff" USING "btree" ("event_id", "sort_order");

CREATE INDEX "idx_admin_event_access_admin_user_id" ON "public"."admin_event_access" USING "btree" ("admin_user_id");

CREATE INDEX "idx_admin_event_access_event_id" ON "public"."admin_event_access" USING "btree" ("event_id");

CREATE INDEX "idx_agenda_event_external_id" ON "public"."agenda_items" USING "btree" ("event_id", "external_id");

CREATE INDEX "idx_agenda_external_id" ON "public"."agenda_items" USING "btree" ("event_id", "external_id");

CREATE INDEX "idx_agenda_import_key" ON "public"."agenda_items" USING "btree" ("event_id", "import_key");

CREATE INDEX "idx_announcements_event_id" ON "public"."announcements" USING "btree" ("event_id");

CREATE INDEX "idx_engagement_attendee" ON "public"."engagement_activity" USING "btree" ("attendee_id");

CREATE INDEX "idx_engagement_event" ON "public"."engagement_activity" USING "btree" ("event_id");

CREATE INDEX "idx_engagement_time" ON "public"."engagement_activity" USING "btree" ("activity_time" DESC);

CREATE INDEX "idx_engagement_type" ON "public"."engagement_activity" USING "btree" ("activity_type");

CREATE INDEX "idx_event_locations_event_id" ON "public"."event_locations" USING "btree" ("event_id");

CREATE INDEX "idx_master_maps_area_group_id" ON "public"."master_maps" USING "btree" ("area_group_id");

CREATE INDEX "idx_nearby_template_places_google" ON "public"."nearby_template_places" USING "btree" ("google_place_id");

CREATE INDEX "idx_nearby_template_places_template" ON "public"."nearby_template_places" USING "btree" ("template_id");

CREATE INDEX "idx_participant_activity_attendee" ON "public"."participant_activity_log" USING "btree" ("attendee_id");

CREATE INDEX "idx_participant_activity_event" ON "public"."participant_activity_log" USING "btree" ("event_id");

CREATE INDEX "idx_participant_activity_time" ON "public"."participant_activity_log" USING "btree" ("occurred_at" DESC);

CREATE INDEX "idx_shared_area_locations_area_group_id" ON "public"."shared_area_locations" USING "btree" ("area_group_id");

CREATE INDEX "idx_shared_area_locations_priority" ON "public"."shared_area_locations" USING "btree" ("priority");

CREATE UNIQUE INDEX "master_maps_one_draft_per_group" ON "public"."master_maps" USING "btree" ("map_group") WHERE ("status" = 'draft'::"text");

CREATE UNIQUE INDEX "master_maps_one_published_per_group" ON "public"."master_maps" USING "btree" ("map_group") WHERE ("status" = 'published'::"text");

CREATE INDEX "nearby_event_area_id_idx" ON "public"."nearby_event" USING "btree" ("area_id");

CREATE INDEX "nearby_event_event_id_idx" ON "public"."nearby_event" USING "btree" ("event_id");

CREATE INDEX "nearby_master_area_id_idx" ON "public"."nearby_master" USING "btree" ("area_id");

CREATE INDEX "nearby_master_places_area_id_idx" ON "public"."nearby_master_places" USING "btree" ("area_id");

CREATE UNIQUE INDEX "ux_master_map_sites_map_site" ON "public"."master_map_sites" USING "btree" ("master_map_id", "site_number");

CREATE UNIQUE INDEX "ux_parking_sites_event_master_site" ON "public"."parking_sites" USING "btree" ("event_id", "master_site_id");

CREATE UNIQUE INDEX "vendors_access_token_key" ON "public"."vendors" USING "btree" ("access_token") WHERE ("access_token" IS NOT NULL);

ALTER TABLE ONLY "public"."activities"
  ADD CONSTRAINT "activities_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."activity_registrations"
  ADD CONSTRAINT "activity_registrations_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."activity_registrations"
  ADD CONSTRAINT "activity_registrations_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."admin_event_access"
  ADD CONSTRAINT "admin_event_access_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."admin_event_access"
  ADD CONSTRAINT "admin_event_access_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."admin_event_permissions"
  ADD CONSTRAINT "admin_event_permissions_admin_event_access_id_fkey" FOREIGN KEY ("admin_event_access_id") REFERENCES "public"."admin_event_access"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."admin_permissions"
  ADD CONSTRAINT "admin_permissions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."agenda_items"
  ADD CONSTRAINT "agenda_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."agenda_categories"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."agenda_items"
  ADD CONSTRAINT "agenda_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."agenda_template_categories"
  ADD CONSTRAINT "agenda_template_categories_template_set_id_fkey" FOREIGN KEY ("template_set_id") REFERENCES "public"."agenda_template_sets"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."agenda_template_items"
  ADD CONSTRAINT "agenda_template_items_template_category_id_fkey" FOREIGN KEY ("template_category_id") REFERENCES "public"."agenda_template_categories"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."agenda_template_items"
  ADD CONSTRAINT "agenda_template_items_template_set_id_fkey" FOREIGN KEY ("template_set_id") REFERENCES "public"."agenda_template_sets"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."announcements"
  ADD CONSTRAINT "announcements_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."engagement_activity"
  ADD CONSTRAINT "engagement_activity_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."engagement_activity"
  ADD CONSTRAINT "engagement_activity_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."event_import_rows"
  ADD CONSTRAINT "event_import_rows_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."event_locations"
  ADD CONSTRAINT "event_locations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."event_map_settings"
  ADD CONSTRAINT "event_map_settings_assigned_nearby_area_id_fkey" FOREIGN KEY ("assigned_nearby_area_id") REFERENCES "public"."nearby_areas"("id");

ALTER TABLE ONLY "public"."event_map_settings"
  ADD CONSTRAINT "event_map_settings_selected_master_map_id_fkey" FOREIGN KEY ("selected_master_map_id") REFERENCES "public"."master_maps"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."event_nearby_places"
  ADD CONSTRAINT "event_nearby_places_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."event_nearby_places"
  ADD CONSTRAINT "event_nearby_places_master_place_id_fkey" FOREIGN KEY ("master_place_id") REFERENCES "public"."nearby_master_places"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."event_photo_metadata"
  ADD CONSTRAINT "event_photo_metadata_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "public"."event_photos"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."event_print_settings"
  ADD CONSTRAINT "event_print_settings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."event_staff"
  ADD CONSTRAINT "event_staff_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."event_vendors"
  ADD CONSTRAINT "event_vendors_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."event_vendors"
  ADD CONSTRAINT "event_vendors_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."imports"
  ADD CONSTRAINT "imports_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id");

ALTER TABLE ONLY "public"."master_map_locations"
  ADD CONSTRAINT "master_map_locations_master_map_id_fkey" FOREIGN KEY ("master_map_id") REFERENCES "public"."master_maps"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."master_map_sites"
  ADD CONSTRAINT "master_map_sites_master_map_id_fkey" FOREIGN KEY ("master_map_id") REFERENCES "public"."master_maps"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."master_maps"
  ADD CONSTRAINT "master_maps_area_group_id_fkey" FOREIGN KEY ("area_group_id") REFERENCES "public"."area_groups"("id");

ALTER TABLE ONLY "public"."nearby_event"
  ADD CONSTRAINT "nearby_event_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "public"."nearby_areas"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."nearby_event"
  ADD CONSTRAINT "nearby_event_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."nearby_event"
  ADD CONSTRAINT "nearby_event_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "public"."nearby_master"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."nearby_master"
  ADD CONSTRAINT "nearby_master_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "public"."nearby_areas"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."nearby_master_places"
  ADD CONSTRAINT "nearby_master_places_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "public"."nearby_areas"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."nearby_template_places"
  ADD CONSTRAINT "nearby_template_places_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."nearby_area_templates"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."parking_sites"
  ADD CONSTRAINT "parking_sites_assigned_attendee_id_fkey" FOREIGN KEY ("assigned_attendee_id") REFERENCES "public"."attendees"("id");

ALTER TABLE ONLY "public"."parking_sites"
  ADD CONSTRAINT "parking_sites_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."parking_sites"
  ADD CONSTRAINT "parking_sites_master_site_id_fkey" FOREIGN KEY ("master_site_id") REFERENCES "public"."master_map_sites"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."participant_activity_log"
  ADD CONSTRAINT "participant_activity_log_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."participant_activity_log"
  ADD CONSTRAINT "participant_activity_log_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."photo_display_log"
  ADD CONSTRAINT "photo_display_log_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "public"."event_photos"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."shared_area_locations"
  ADD CONSTRAINT "shared_area_locations_area_group_id_fkey" FOREIGN KEY ("area_group_id") REFERENCES "public"."area_groups"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_roles"
  ADD CONSTRAINT "user_roles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."validation_rules"
  ADD CONSTRAINT "validation_rules_applies_to_event_id_fkey" FOREIGN KEY ("applies_to_event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."vendor_service_requests"
  ADD CONSTRAINT "vendor_service_requests_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."vendor_service_requests"
  ADD CONSTRAINT "vendor_service_requests_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."vendor_service_requests"
  ADD CONSTRAINT "vendor_service_requests_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."vendor_services"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."vendor_service_requests"
  ADD CONSTRAINT "vendor_service_requests_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."vendor_services"
  ADD CONSTRAINT "vendor_services_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;

COMMIT;
