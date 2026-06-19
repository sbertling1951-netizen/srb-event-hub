create extension if not exists pgcrypto;

create table if not exists evaluation_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text,
  event_type text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists evaluation_questions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references evaluation_templates(id) on delete cascade,
  question_text text not null,
  question_type text not null,
  display_order integer not null,
  required boolean not null default false,
  allow_comment boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists evaluation_choices (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references evaluation_questions(id) on delete cascade,
  choice_text text not null,
  display_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists event_evaluations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  attendee_id uuid not null references attendees(id) on delete cascade,
  is_complete boolean not null default false,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, attendee_id)
);

create table if not exists event_evaluation_answers (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references event_evaluations(id) on delete cascade,
  question_id uuid not null references evaluation_questions(id) on delete cascade,
  choice_id uuid references evaluation_choices(id) on delete set null,
  answer_text text,
  comment_text text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (evaluation_id, question_id)
);

insert into evaluation_templates (
  name,
  description,
  category,
  event_type
)
values (
  'RV Rally Evaluation',
  'Default evaluation template for RV rallies and chapter events.',
  'association',
  'rv_rally'
)

on conflict do nothing;

insert into evaluation_questions (
  template_id,
  question_text,
  question_type,
  display_order,
  required,
  allow_comment
)
select
  t.id,
  q.question_text,
  q.question_type,
  q.display_order,
  q.required,
  q.allow_comment
from evaluation_templates t
cross join (
  values
    ('What was your overall impression of this event?', 'single_choice', 1, true, true),
    ('What parts of the event provided the most value?', 'multi_choice', 2, true, true),
    ('Where did we miss the mark?', 'multi_choice', 3, false, true),
    ('What would you like to see at future events?', 'multi_choice', 4, false, true),
    ('What was your favorite memory from this event?', 'text', 5, false, false),
    ('Anything else you would like us to know?', 'text', 6, false, false),
    ('How likely are you to attend another event?', 'single_choice', 7, true, true)
) as q(question_text, question_type, display_order, required, allow_comment)
where t.event_type = 'rv_rally';

insert into evaluation_choices (
  question_id,
  choice_text,
  display_order
)
select
  q.id,
  c.choice_text,
  c.display_order
from evaluation_questions q
cross join (
  values
    ('Excellent', 1),
    ('Very Good', 2),
    ('Good', 3),
    ('Fair', 4),
    ('Poor', 5)
) as c(choice_text, display_order)
where q.question_text = 'What was your overall impression of this event?';

insert into evaluation_choices (
  question_id,
  choice_text,
  display_order
)
select
  q.id,
  c.choice_text,
  c.display_order
from evaluation_questions q
cross join (
  values
    ('Technical Seminars', 1),
    ('Social Activities', 2),
    ('Friendships & Camaraderie', 3),
    ('Vendor Displays', 4),
    ('Coach Tours', 5),
    ('Local Tours', 6),
    ('Entertainment', 7),
    ('Meals', 8),
    ('Other', 9)
) as c(choice_text, display_order)
where q.question_text = 'What parts of the event provided the most value?';

insert into evaluation_choices (
  question_id,
  choice_text,
  display_order
)
select
  q.id,
  c.choice_text,
  c.display_order
from evaluation_questions q
cross join (
  values
    ('Parking', 1),
    ('Registration', 2),
    ('Communications', 3),
    ('Agenda', 4),
    ('Venue', 5),
    ('Technology', 6),
    ('Meals', 7),
    ('Entertainment', 8),
    ('Other', 9)
) as c(choice_text, display_order)
where q.question_text = 'Where did we miss the mark?';

insert into evaluation_choices (
  question_id,
  choice_text,
  display_order
)
select
  q.id,
  c.choice_text,
  c.display_order
from evaluation_questions q
cross join (
  values
    ('More Technical Training', 1),
    ('More Social Activities', 2),
    ('More Local Tours', 3),
    ('More Vendor Participation', 4),
    ('More Coach Maintenance Sessions', 5),
    ('More Entertainment', 6),
    ('Longer Event', 7),
    ('Shorter Event', 8),
    ('Other', 9)
) as c(choice_text, display_order)
where q.question_text = 'What would you like to see at future events?';

insert into evaluation_choices (
  question_id,
  choice_text,
  display_order
)
select
  q.id,
  c.choice_text,
  c.display_order
from evaluation_questions q
cross join (
  values
    ('Definitely', 1),
    ('Likely', 2),
    ('Maybe', 3),
    ('Unlikely', 4),
    ('No', 5)
) as c(choice_text, display_order)
where q.question_text = 'How likely are you to attend another event?';
