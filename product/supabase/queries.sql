-- Useful queries for product/debug dashboards.

-- 1. Build a compact Student Model view for the Tutor Agent.
select
  s.id as student_id,
  s.nickname,
  s.age_band,
  s.learning_goal,
  coalesce(json_agg(distinct si.label) filter (where si.label is not null), '[]') as interests,
  coalesce(
    json_object_agg(
      sm.skill_id,
      json_build_object(
        'mastery', sm.mastery,
        'status', sm.status,
        'attempts', sm.attempts,
        'correct', sm.correct_attempts,
        'hintCount', sm.hint_count,
        'lastResult', sm.last_result
      )
    ) filter (where sm.skill_id is not null),
    '{}'::json
  ) as skills
from students s
left join student_interests si on si.student_id = s.id
left join student_skill_mastery sm on sm.student_id = s.id
where s.id = :student_id
group by s.id;

-- 2. Active misconceptions.
select
  misconception_key,
  skill_id,
  description,
  evidence_count,
  severity,
  last_seen_at
from student_misconceptions
where student_id = :student_id
  and active = true
order by severity desc, evidence_count desc;

-- 3. Mastery trajectory for one skill.
select
  created_at,
  mastery
from mastery_snapshots
where student_id = :student_id
  and skill_id = :skill_id
order by created_at;

-- 4. Recent lessons and adult summaries.
select
  id,
  subject,
  target_skill_id,
  difficulty,
  status,
  planner_reason,
  adult_summary,
  started_at,
  ended_at
from lesson_sessions
where student_id = :student_id
order by started_at desc
limit 10;

-- 5. Recent diagnostic error classifications.
select
  ec.created_at,
  ec.skill_id,
  ec.error_type,
  ec.misconception_key,
  ec.confidence,
  ec.inferred_work,
  ec.recommended_action,
  ec.evidence
from error_classifications ec
where ec.student_id = :student_id
order by ec.created_at desc
limit 20;

-- 6. Recent offline activities and adult observations.
select
  oa.assigned_at,
  oa.title,
  oa.domain,
  oa.target_skill_id,
  oo.completion,
  oo.support,
  oo.behaviour,
  oo.notes,
  oo.created_at as observed_at
from offline_activity_assignments oa
left join offline_observations oo on oo.assignment_id = oa.id
where oa.student_id = :student_id
order by oa.assigned_at desc
limit 10;
