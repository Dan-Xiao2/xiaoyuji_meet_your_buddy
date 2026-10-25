-- Demo seed data for local Supabase testing.
-- Safe for MVP demos: uses anonymous pilot identities only.

insert into knowledge_skills (id, subject, display_name, description, min_age_band, max_age_band)
values
  ('math.counting_1_to_5', 'math', '1-5 点数', '能稳定数出 1 到 5 个具体物品', '3-4', '5-6'),
  ('math.subtract_as_takeaway', 'math', '理解“拿走”', '能把减法理解成从一组物品里拿走一部分', '4-5', '6-7'),
  ('math.answer_after_visual_prompt', 'math', '看白板后回答', '能根据视觉提示说出结果', '4-5', '6-7'),
  ('language.full_sentence', 'language', '完整表达', '能在提示下说出完整句子', '3-4', '6-7'),
  ('algebra.distributive_property', 'algebra', '分配律', '能把系数分配到括号里的每一项', '6-7', '12+')
on conflict (id) do nothing;

insert into guardian_profiles (id, role, display_name)
values
  ('11111111-1111-1111-1111-111111111111', 'teacher', '幼儿园内测老师')
on conflict (id) do nothing;

insert into students (id, guardian_id, nickname, age_band, learning_goal, consent_for_pilot)
values
  (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    '安安',
    '4-5',
    '愿意表达自己的想法，并建立 5 以内数感',
    true
  )
on conflict (id) do nothing;

insert into student_interests (student_id, label, source, evidence_count)
values
  ('22222222-2222-2222-2222-222222222222', '动物', 'profile', 2),
  ('22222222-2222-2222-2222-222222222222', '颜色', 'profile', 2),
  ('22222222-2222-2222-2222-222222222222', '故事', 'profile', 1)
on conflict (student_id, label) do update set evidence_count = excluded.evidence_count;

insert into student_skill_mastery
  (student_id, skill_id, mastery, status, attempts, correct_attempts, hint_count, last_result)
values
  ('22222222-2222-2222-2222-222222222222', 'math.counting_1_to_5', 0.720, 'practicing', 5, 4, 1, 'correct'),
  ('22222222-2222-2222-2222-222222222222', 'math.subtract_as_takeaway', 0.320, 'emerging', 2, 0, 1, 'hinted'),
  ('22222222-2222-2222-2222-222222222222', 'math.answer_after_visual_prompt', 0.450, 'emerging', 2, 1, 1, 'correct'),
  ('22222222-2222-2222-2222-222222222222', 'language.full_sentence', 0.420, 'emerging', 3, 1, 2, 'hinted'),
  ('22222222-2222-2222-2222-222222222222', 'algebra.distributive_property', 0.720, 'practicing', 4, 3, 0, 'correct')
on conflict (student_id, skill_id) do update set
  mastery = excluded.mastery,
  status = excluded.status,
  attempts = excluded.attempts,
  correct_attempts = excluded.correct_attempts,
  hint_count = excluded.hint_count,
  last_result = excluded.last_result;

insert into student_misconceptions
  (student_id, skill_id, misconception_key, description, evidence_count, severity)
values
  (
    '22222222-2222-2222-2222-222222222222',
    'math.subtract_as_takeaway',
    'subtraction_means_count_all',
    '可能会把减法当成重新数一遍，还没有稳定理解“拿走”动作。',
    1,
    0.40
  )
  ,
  (
    '22222222-2222-2222-2222-222222222222',
    'algebra.distributive_property',
    'failed_distributive_property_constant',
    '只把系数乘到变量，没有乘到括号里的常数项。',
    0,
    0.00
  )
on conflict (student_id, misconception_key) do update set
  description = excluded.description,
  evidence_count = excluded.evidence_count,
  severity = excluded.severity;

insert into learning_style_observations
  (student_id, dimension, strength, confidence, evidence_count, notes)
values
  ('22222222-2222-2222-2222-222222222222', 'visual_support', 0.85, 0.50, 3, '看见物品被划掉后更容易回答。'),
  ('22222222-2222-2222-2222-222222222222', 'long_explanation_tolerance', 0.25, 0.40, 2, '长句解释容易中断，适合短轮次。'),
  ('22222222-2222-2222-2222-222222222222', 'story_context', 0.75, 0.45, 2, '用动物或故事开头时更愿意回应。')
on conflict (student_id, dimension) do update set
  strength = excluded.strength,
  confidence = excluded.confidence,
  evidence_count = excluded.evidence_count,
  notes = excluded.notes;

insert into behaviour_metrics
  (student_id, avg_session_minutes, frustration_threshold, hint_dependency, avg_turns_before_disengagement, successful_session_count)
values
  ('22222222-2222-2222-2222-222222222222', 6.50, 'after_2_incorrect_attempts', 0.35, 8.00, 1)
on conflict (student_id) do update set
  avg_session_minutes = excluded.avg_session_minutes,
  frustration_threshold = excluded.frustration_threshold,
  hint_dependency = excluded.hint_dependency,
  avg_turns_before_disengagement = excluded.avg_turns_before_disengagement,
  successful_session_count = excluded.successful_session_count;
