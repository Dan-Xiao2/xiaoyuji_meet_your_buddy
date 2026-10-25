-- Row Level Security policy draft for Supabase.
-- For pilot: adults own students. Children should not directly access database rows.

alter table guardian_profiles enable row level security;
alter table students enable row level security;
alter table student_interests enable row level security;
alter table student_skill_mastery enable row level security;
alter table student_misconceptions enable row level security;
alter table learning_style_observations enable row level security;
alter table behaviour_metrics enable row level security;
alter table lesson_sessions enable row level security;
alter table lesson_questions enable row level security;
alter table student_answers enable row level security;
alter table error_classifications enable row level security;
alter table student_events enable row level security;
alter table offline_activity_assignments enable row level security;
alter table offline_observations enable row level security;
alter table mastery_snapshots enable row level security;

-- Public catalog: skill definitions are not personal data.
alter table knowledge_skills enable row level security;

create policy "read skill catalog"
on knowledge_skills
for select
to authenticated
using (true);

create policy "guardian can read own profile"
on guardian_profiles
for select
to authenticated
using (auth.uid() = auth_user_id);

create policy "guardian can update own profile"
on guardian_profiles
for update
to authenticated
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);

-- Helper condition repeated below:
-- A row is accessible when its student belongs to the logged-in adult.

create policy "guardian can read own students"
on students
for select
to authenticated
using (
  guardian_id in (
    select id from guardian_profiles where auth_user_id = auth.uid()
  )
);

create policy "guardian can insert own students"
on students
for insert
to authenticated
with check (
  guardian_id in (
    select id from guardian_profiles where auth_user_id = auth.uid()
  )
);

create policy "guardian can update own students"
on students
for update
to authenticated
using (
  guardian_id in (
    select id from guardian_profiles where auth_user_id = auth.uid()
  )
)
with check (
  guardian_id in (
    select id from guardian_profiles where auth_user_id = auth.uid()
  )
);

create policy "guardian can read student interests"
on student_interests
for select
to authenticated
using (
  student_id in (
    select s.id
    from students s
    join guardian_profiles g on g.id = s.guardian_id
    where g.auth_user_id = auth.uid()
  )
);

create policy "guardian can read skill mastery"
on student_skill_mastery
for select
to authenticated
using (
  student_id in (
    select s.id
    from students s
    join guardian_profiles g on g.id = s.guardian_id
    where g.auth_user_id = auth.uid()
  )
);

create policy "guardian can read misconceptions"
on student_misconceptions
for select
to authenticated
using (
  student_id in (
    select s.id
    from students s
    join guardian_profiles g on g.id = s.guardian_id
    where g.auth_user_id = auth.uid()
  )
);

create policy "guardian can read learning style"
on learning_style_observations
for select
to authenticated
using (
  student_id in (
    select s.id
    from students s
    join guardian_profiles g on g.id = s.guardian_id
    where g.auth_user_id = auth.uid()
  )
);

create policy "guardian can read behaviour metrics"
on behaviour_metrics
for select
to authenticated
using (
  student_id in (
    select s.id
    from students s
    join guardian_profiles g on g.id = s.guardian_id
    where g.auth_user_id = auth.uid()
  )
);

create policy "guardian can read lesson sessions"
on lesson_sessions
for select
to authenticated
using (
  student_id in (
    select s.id
    from students s
    join guardian_profiles g on g.id = s.guardian_id
    where g.auth_user_id = auth.uid()
  )
);

create policy "guardian can read student events"
on student_events
for select
to authenticated
using (
  student_id in (
    select s.id
    from students s
    join guardian_profiles g on g.id = s.guardian_id
    where g.auth_user_id = auth.uid()
  )
);

create policy "guardian can read error classifications"
on error_classifications
for select
to authenticated
using (
  student_id in (
    select s.id
    from students s
    join guardian_profiles g on g.id = s.guardian_id
    where g.auth_user_id = auth.uid()
  )
);

create policy "guardian can read mastery trajectory"
on mastery_snapshots
for select
to authenticated
using (
  student_id in (
    select s.id
    from students s
    join guardian_profiles g on g.id = s.guardian_id
    where g.auth_user_id = auth.uid()
  )
);

create policy "guardian can read offline assignments"
on offline_activity_assignments
for select
to authenticated
using (
  student_id in (
    select s.id
    from students s
    join guardian_profiles g on g.id = s.guardian_id
    where g.auth_user_id = auth.uid()
  )
);

create policy "guardian can read offline observations"
on offline_observations
for select
to authenticated
using (
  student_id in (
    select s.id
    from students s
    join guardian_profiles g on g.id = s.guardian_id
    where g.auth_user_id = auth.uid()
  )
);

create policy "guardian can insert offline observations"
on offline_observations
for insert
to authenticated
with check (
  student_id in (
    select s.id
    from students s
    join guardian_profiles g on g.id = s.guardian_id
    where g.auth_user_id = auth.uid()
  )
);

-- Server-side writes should use Supabase service role from a trusted backend/edge function.
-- Do not expose service_role key in the browser.
