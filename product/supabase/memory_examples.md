# Student Memory Examples

These examples show the difference between raw chat history and structured student memory.

## Weak Memory

```json
{
  "history": "安安昨天问过 5 以内减法。"
}
```

This is not enough to change teaching strategy.

## Useful Structured Memory

```json
{
  "studentId": "22222222-2222-2222-2222-222222222222",
  "knowledge": {
    "math.counting_1_to_5": {
      "mastery": 0.72,
      "status": "practicing"
    },
    "math.subtract_as_takeaway": {
      "mastery": 0.32,
      "status": "emerging"
    }
  },
  "misconceptions": [
    {
      "skill": "math.subtract_as_takeaway",
      "pattern": "可能会把减法当成重新数一遍，还没有稳定理解拿走动作。",
      "evidenceCount": 1
    }
  ],
  "learningStyle": {
    "visual_support": {
      "strength": 0.85,
      "confidence": 0.5
    },
    "long_explanation_tolerance": {
      "strength": 0.25,
      "confidence": 0.4
    }
  },
  "behaviour": {
    "avgSessionMinutes": 6.5,
    "hintDependency": 0.35,
    "frustrationThreshold": "after_2_incorrect_attempts"
  },
  "nextLessonSuggestion": {
    "skill": "math.subtract_as_takeaway",
    "difficulty": "easy",
    "format": "story_with_objects",
    "reason": "先用具体物品理解拿走，暂时不抽象成算式。"
  }
}
```

## Tutor Context Generated From Memory

```text
Student: 安安, 4-5
Goal: 建立 5 以内数感并愿意表达
Known strengths: can count 1-5 with visual support
Current target: subtraction as takeaway
Risk: long explanations reduce engagement
Teaching move: use short sentence + visual whiteboard + one question
Do not: introduce written equation first
```

## Product Rule

Store raw conversations only as short-term evidence. The durable product asset is the structured student model:

- knowledge mastery
- misconception evidence
- learning style observations
- behaviour metrics
- lesson history
- mastery trajectory

## Error Classification Example

Question:

```text
3(x + 4) = 21
```

If the student writes:

```text
3x + 4 = 21
```

The useful memory update is:

```json
{
  "errorType": "failed_distributive_property",
  "misconceptionKey": "failed_distributive_property_constant",
  "confidence": 0.92,
  "inferredWork": "3x + 4 = 21",
  "masteryUpdate": {
    "skill": "algebra.distributive_property",
    "from": 0.72,
    "to": 0.58
  },
  "recommendedAction": "trigger_visual_explanation",
  "nextQuestion": "2(x + 5) = 18"
}
```

The next lesson should test the same misconception and, if repeated, trigger a visual tool:

```text
3 × (x + 4)

[x + 4]
[x + 4]
[x + 4]
```
