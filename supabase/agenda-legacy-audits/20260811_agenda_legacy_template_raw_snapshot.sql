-- Durable raw recoverability snapshot of the legacy Agenda template
-- system, captured before Stage 3B canonical preservation and before any
-- future Stage 3C retirement. Source: linked production database, taken
-- 2026-08-11 as part of Agenda Legacy Template Retirement Stage 3B.
--
-- Purpose: exact reconstruction of the legacy rows if ever needed after
-- the legacy tables are dropped in a future stage. This is evidence, not
-- an executable migration -- it lives outside supabase/migrations/ and
-- is never applied automatically. Every row below was verified present
-- in production at snapshot time (Stage 3A/3B audit counts: 2 templates,
-- 2 sets, 5 categories, 12 items, 1 Event association).
--
-- Row counts at snapshot time: agenda_templates=2, agenda_template_sets=2,
-- agenda_template_categories=5, agenda_template_items=12,
-- events.assigned_agenda_template_id non-null=1.

-- ============================================================
-- agenda_templates (2 rows)
-- ============================================================
INSERT INTO public.agenda_templates (id, name, description, status, created_at, updated_at) VALUES
('d3fd38e7-76a3-45e3-8ea0-afacc4d55430', 'Default Rally Agenda', 'Starter agenda template for testing', 'active', '2026-04-06T17:21:35.254184+00:00', '2026-04-06T17:21:35.254184+00:00'),
('2b3e71a0-f027-46c7-98fe-cea4adeb1aca', 'Basic Agenda', 'Template to follow for agenda setup. Modify as needed and save under event name.', 'active', '2026-04-26T22:05:02.487136+00:00', '2026-04-26T22:05:02.487136+00:00');

-- ============================================================
-- agenda_template_sets (2 rows)
-- ============================================================
INSERT INTO public.agenda_template_sets (id, name, description, is_active, sort_order, created_at, updated_at) VALUES
('a28bf6b7-f6e8-4b74-b610-41610d51def2', 'Standard FCOC Event Template', 'Default categories and agenda structure for FCOC events', true, 1, '2026-03-22T02:33:36.018934+00:00', '2026-03-22T02:33:36.018934+00:00'),
('d3fd38e7-76a3-45e3-8ea0-afacc4d55430', 'Default Rally Agenda', 'Starter agenda template for testing', true, 1, '2026-04-06T17:32:43.274767+00:00', '2026-04-06T17:32:43.274767+00:00');

-- ============================================================
-- agenda_template_categories (5 rows, all under set a28bf6b7,
-- confirmed unreferenced by any of the 12 items -- template_category_id
-- is NULL on every item -- included here purely for exact recoverability)
-- ============================================================
INSERT INTO public.agenda_template_categories (id, template_set_id, name, color, sort_order, created_at, updated_at) VALUES
('c5b970b3-4f12-4088-8d5a-4caabf9ef55a', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'Meal', '#f4d79a', 1, '2026-03-22T02:38:45.361414+00:00', '2026-03-22T02:38:45.361414+00:00'),
('d96bf8fd-c8cd-46a2-975c-285195ee56ed', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'Seminar', '#93c5fd', 2, '2026-03-22T02:38:45.361414+00:00', '2026-03-22T02:38:45.361414+00:00'),
('6234fbb4-6474-4fd5-9e1b-17e544464574', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'Tour', '#86efac', 3, '2026-03-22T02:38:45.361414+00:00', '2026-03-22T02:38:45.361414+00:00'),
('111d4e95-9ce1-4fde-8662-564a90da3d5e', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'Check-In', '#fde68a', 4, '2026-03-22T02:38:45.361414+00:00', '2026-03-22T02:38:45.361414+00:00'),
('7d59da4e-b971-4714-a8e2-e2862ffb3039', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'Social', '#d8b4fe', 5, '2026-03-22T02:38:45.361414+00:00', '2026-03-22T02:38:45.361414+00:00');

-- ============================================================
-- agenda_template_items (12 rows)
-- Group 1 (10 rows): template_id=template_set_id=a28bf6b7 (relative-time
-- shaped: day_offset + start/end_time_template text fields; no
-- agenda_date/start_time/end_time; no category/color/description/speaker/
-- external_id).
-- Group 2 (2 rows): template_id=template_set_id=d3fd38e7 (absolute-date
-- shaped: agenda_date + start_time/end_time; full category/color/
-- description/speaker/external_id).
-- ============================================================
INSERT INTO public.agenda_template_items (
  id, template_id, template_set_id, template_category_id, external_id, title, description, location,
  speaker, category, color, agenda_date, start_time, end_time, day_offset,
  start_time_template, end_time_template, is_all_day, is_published, sort_order, created_at, updated_at
) VALUES
('66c3b0c2-7d56-4697-b078-7c373f4f066d', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', NULL, NULL, 'Arrival / Check-In Opens', NULL, 'Main Office', NULL, NULL, NULL, NULL, NULL, NULL, 0, '13:00', '17:00', false, true, 1, '2026-03-22T02:40:25.765787+00:00', '2026-04-06T17:24:35.143289+00:00'),
('b3e80b7a-88af-4cbb-a5d0-8ec3475bf12f', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', NULL, NULL, 'Welcome Gathering', NULL, 'Main Hall', NULL, NULL, NULL, NULL, NULL, NULL, 0, '18:00', '19:00', false, true, 2, '2026-03-22T02:40:25.765787+00:00', '2026-04-06T17:24:35.143289+00:00'),
('6b72b9db-512b-43d4-a55b-e532ffe60a8c', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', NULL, NULL, 'Dinner', NULL, 'Event Center', NULL, NULL, NULL, NULL, NULL, NULL, 0, '19:00', '20:00', false, true, 3, '2026-03-22T02:40:25.765787+00:00', '2026-04-06T17:24:35.143289+00:00'),
('337d56db-2c7a-4081-a026-2edc446d2e17', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', NULL, NULL, 'Breakfast', NULL, 'Dining Area', NULL, NULL, NULL, NULL, NULL, NULL, 1, '08:00', '09:00', false, true, 4, '2026-03-22T02:40:25.765787+00:00', '2026-04-06T17:24:35.143289+00:00'),
('81566965-fa6a-4991-9ffa-033faabe4476', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', NULL, NULL, 'Morning Seminar', NULL, 'Seminar Room', NULL, NULL, NULL, NULL, NULL, NULL, 1, '09:30', '11:00', false, true, 5, '2026-03-22T02:40:25.765787+00:00', '2026-04-06T17:24:35.143289+00:00'),
('0ce7f20a-2f8b-4eec-9aa2-a4637ca850ac', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', NULL, NULL, 'Lunch', NULL, 'Dining Area', NULL, NULL, NULL, NULL, NULL, NULL, 1, '12:00', '13:00', false, true, 6, '2026-03-22T02:40:25.765787+00:00', '2026-04-06T17:24:35.143289+00:00'),
('3d4ae526-4872-466d-adb3-4e72873acc15', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', NULL, NULL, 'Afternoon Seminar', NULL, 'Seminar Room', NULL, NULL, NULL, NULL, NULL, NULL, 1, '13:30', '15:00', false, true, 7, '2026-03-22T02:40:25.765787+00:00', '2026-04-06T17:24:35.143289+00:00'),
('a5439cee-ded8-46ff-a0d3-fab387c9abc9', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', NULL, NULL, 'Social Hour', NULL, 'Clubhouse', NULL, NULL, NULL, NULL, NULL, NULL, 1, '17:00', '18:00', false, true, 8, '2026-03-22T02:40:25.765787+00:00', '2026-04-06T17:24:35.143289+00:00'),
('85257c08-ae12-4073-bcc5-d7744b999419', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', NULL, NULL, 'Dinner', NULL, 'Event Center', NULL, NULL, NULL, NULL, NULL, NULL, 1, '18:30', '19:30', false, true, 9, '2026-03-22T02:40:25.765787+00:00', '2026-04-06T17:24:35.143289+00:00'),
('e1bd30f8-fdc9-424d-a89b-d410973837b9', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', NULL, NULL, 'Departure Breakfast', NULL, 'Dining Area', NULL, NULL, NULL, NULL, NULL, NULL, 2, '08:00', '09:00', false, true, 10, '2026-03-22T02:40:25.765787+00:00', '2026-04-06T17:24:35.143289+00:00'),
('b0fbc929-50c5-4be4-bec4-94a6b13762d3', 'd3fd38e7-76a3-45e3-8ea0-afacc4d55430', 'd3fd38e7-76a3-45e3-8ea0-afacc4d55430', NULL, 'welcome-1', 'Welcome Session', 'Opening remarks and orientation', 'Main Hall', 'Host', 'General', '#dbeafe', '2026-07-01', '09:00:00', '10:00:00', NULL, NULL, NULL, false, true, 1, '2026-04-06T17:32:59.559897+00:00', '2026-04-06T17:32:59.559897+00:00'),
('b938bec4-b934-4ce1-a8a5-1b52b646f7ca', 'd3fd38e7-76a3-45e3-8ea0-afacc4d55430', 'd3fd38e7-76a3-45e3-8ea0-afacc4d55430', NULL, 'tech-session-1', 'Technical Session', 'Chassis systems overview', 'Training Room', 'Tech Speaker', 'Training', '#dcfce7', '2026-07-01', '10:30:00', '11:30:00', NULL, NULL, NULL, false, true, 2, '2026-04-06T17:32:59.559897+00:00', '2026-04-06T17:32:59.559897+00:00');

-- ============================================================
-- Historical Event association (1 row): events.assigned_agenda_template_id
-- This is a legacy UI-selection pointer, NOT proof of a governed content
-- application (agenda_template_applications has 0 rows for this Event).
-- ============================================================
-- events.id = '53136dfb-b039-40b1-9adf-dcb4d648ea87' (name: "Amana Event & Annual Business Meeting", status: Inactive)
--   .assigned_agenda_template_id = 'd3fd38e7-76a3-45e3-8ea0-afacc4d55430' (-> agenda_templates "Default Rally Agenda")
-- To restore only this pointer (schema permitting):
-- UPDATE public.events SET assigned_agenda_template_id = 'd3fd38e7-76a3-45e3-8ea0-afacc4d55430'
--   WHERE id = '53136dfb-b039-40b1-9adf-dcb4d648ea87';
