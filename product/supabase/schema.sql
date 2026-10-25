-- 小宇记 MVP Student Memory schema
-- Target: Supabase Postgres
-- Principle: store structured learning evidence, not just chat history.

create extension if not exists pgcrypto;

create type student_role as enum ('parent', 'teacher', 'admin');
create type skill_status as enum ('needs_support', 'emerging', 'practicing', 'secure');
create type lesson_status as enum ('planned', 'active', 'completed', 'abandoned');
create type event_type as enum (
  'lesson_started',
  'question_asked',
  'student_answered',
  'hint_requested',
  'mistake_detected',
  'mastery_updated',
  'lesson_completed',
  'offline_task_assigned',
  'offline_observation_submitted'
);

create type teaching_action as enum (
  'continue',
  'test_same_misconception',
  'trigger_visual_explanation',
  'lower_difficulty',
  'escalate_challenge'
);

create table guardian_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  role student_role not null default 'parent',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table students (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid references guardian_profiles(id) on delete cascade,
  nickname text not null,
  age_band text not null check (age_band in ('3-4', '4-5', '5-6', '6-7')),
  learning_goal text,
  consent_for_pilot boolean not null default false,
  data_region text not null default 'pilot_local',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table student_interests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  label text not null,
  source text not null default 'profile',
  evidence_count integer not null default 1,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (student_id, label)
);

create table knowledge_skills (
  id text primary key,
  subject text not null,
  display_name text not null,
  description text,
  min_age_band text,
  max_age_band text,
  created_at timestamptz not null default now()
);

create table student_skill_mastery (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  skill_id text not null references knowledge_skills(id),
  mastery numeric(4,3) not null default 0.250 check (mastery >= 0 and mastery <= 1),
  status skill_status not null default 'emerging',
  attempts integer not null default 0,
  correct_attempts integer not null default 0,
  hint_count integer not null default 0,
  last_result text not null default 'not_started',
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (student_id, skill_id)
);

create table student_misconceptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  skill_id text references knowledge_skills(id),
  misconception_key text not null,
  description text not null,
  evidence_count integer not null default 1,
  severity numeric(3,2) not null default 0.40 check (severity >= 0 and severity <= 1),
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (student_id, misconception_key)
);

create table learning_style_observations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  dimension text not null,
  strength numeric(3,2) not null default 0.50 check (strength >= 0 and strength <= 1),
  confidence numeric(3,2) not null default 0.30 check (confidence >= 0 and confidence <= 1),
  evidence_count integer not null default 1,
  notes text,
  updated_at timestamptz not null default now(),
  unique (student_id, dimension)
);

create table behaviour_metrics (
  student_id uuid primary key references students(id) on delete cascade,
  avg_session_minutes numeric(5,2),
  frustration_threshold text,
  hint_dependency numeric(3,2) not null default 0.00 check (hint_dependency >= 0 and hint_dependency <= 1),
  avg_turns_before_disengagement numeric(5,2),
  successful_session_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table lesson_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  status lesson_status not null default 'planned',
  subject text not null,
  target_skill_id text references knowledge_skills(id),
  difficulty text not null default 'easy',
  planner_reason text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  adult_summary text,
  created_at timestamptz not null default now()
);

create table lesson_questions (
  id uuid primary key default gen_random_uuid(),
  lesson_session_id uuid not null references lesson_sessions(id) on delete cascade,
  skill_id text references knowledge_skills(id),
  prompt text not null,
  expected_answer text,
  whiteboard_state jsonb not null default '{}'::jsonb,
  sequence_index integer not null default 0,
  created_at timestamptz not null default now()
);

create table student_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references lesson_questions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  raw_answer text,
  normalized_answer text,
  is_correct boolean,
  needs_hint boolean not null default false,
  error_type text,
  misconception_key text,
  diagnostic_confidence numeric(3,2) check (diagnostic_confidence >= 0 and diagnostic_confidence <= 1),
  inferred_work text,
  recommended_action teaching_action,
  tutor_feedback text,
  created_at timestamptz not null default now()
);

create table error_classifications (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references student_answers(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  skill_id text references knowledge_skills(id),
  error_type text not null,
  misconception_key text,
  confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
  inferred_work text,
  evidence jsonb not null default '{}'::jsonb,
  recommended_action teaching_action not null default 'continue',
  created_at timestamptz not null default now()
);

create table student_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  lesson_session_id uuid references lesson_sessions(id) on delete set null,
  type event_type not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table offline_activity_assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  lesson_session_id uuid references lesson_sessions(id) on delete set null,
  task_key text not null,
  title text not null,
  domain text not null,
  target_skill_id text references knowledge_skills(id),
  purpose text,
  materials jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  adult_prompt text,
  observe_focus jsonb not null default '[]'::jsonb,
  status text not null default 'assigned',
  assigned_at timestamptz not null default now(),
  completed_at timestamptz
);

create table offline_observations (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references offline_activity_assignments(id) on delete set null,
  student_id uuid not null references students(id) on delete cascade,
  observer_profile_id uuid references guardian_profiles(id) on delete set null,
  target_skill_id text references knowledge_skills(id),
  completion text not null check (completion in ('completed', 'partial', 'not_interested')),
  support text not null check (support in ('no_support', 'some_support', 'much_support')),
  behaviour text not null check (behaviour in ('expressed', 'recounted', 'distracted', 'high_interest')),
  notes text,
  memory_update jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table mastery_snapshots (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  skill_id text not null references knowledge_skills(id),
  mastery numeric(4,3) not null check (mastery >= 0 and mastery <= 1),
  source_event_id uuid references student_events(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_students_guardian_id on students(guardian_id);
create index idx_student_skill_mastery_student on student_skill_mastery(student_id);
create index idx_student_misconceptions_student on student_misconceptions(student_id);
create index idx_lesson_sessions_student on lesson_sessions(student_id, started_at desc);
create index idx_student_events_student_created on student_events(student_id, created_at desc);
create index idx_mastery_snapshots_student_skill on mastery_snapshots(student_id, skill_id, created_at desc);
create index idx_error_classifications_student on error_classifications(student_id, created_at desc);
create index idx_offline_assignments_student on offline_activity_assignments(student_id, assigned_at desc);
create index idx_offline_observations_student on offline_observations(student_id, created_at desc);

-- Keep updated_at fresh for simple tables.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger guardian_profiles_set_updated_at
before update on guardian_profiles
for each row execute function set_updated_at();

create trigger students_set_updated_at
before update on students
for each row execute function set_updated_at();

create trigger student_skill_mastery_set_updated_at
before update on student_skill_mastery
for each row execute function set_updated_at();

create trigger learning_style_observations_set_updated_at
before update on learning_style_observations
for each row execute function set_updated_at();

create trigger behaviour_metrics_set_updated_at
before update on behaviour_metrics
for each row execute function set_updated_at();
