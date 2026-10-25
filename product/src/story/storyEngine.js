import { getDomainLabels, pickStorySeed } from "../content/preschoolContentFramework.js";

export function createStoryLesson(input, studentModel) {
  const seed = pickStorySeed(input, studentModel);
  const character = seed.character;
  const setting = seed.setting;
  const object = seed.object;
  const domainLabels = getDomainLabels(seed.domains);

  return {
    id: `story_${Date.now()}`,
    activity: "story",
    skill: "language.full_sentence",
    difficulty: "easy",
    format: "original_short_story",
    awaitingAnswer: false,
    teachingMove: "tell_then_invite_choice",
    story: {
      id: seed.id,
      title: applyStoryPattern(seed.titlePattern, { character, object }),
      character,
      setting,
      object,
      domains: seed.domains,
      domainLabels,
      scenes: seed.scenes.map((scene) => applyStoryPattern(scene, { character, setting, object })),
      choices: seed.choices.map((choice) => choice.label),
      choiceDetails: seed.choices,
      dialogicPrompts: seed.prompts,
      offlineActivityId: seed.offlineActivityId,
      observationFocus: seed.observationFocus,
      parentPrompt: `听完后，不急着追问对错。可以问孩子：${seed.prompts[0]?.text || "你记得故事里发生了什么？"}`
    },
    plannerReason: `孩子想听故事，当前内容覆盖${domainLabels.join("、")}。先用原创短故事降低操作门槛，同时观察选择、表达和离屏延伸。`
  };
}

export function continueStoryLesson(input, storyLesson) {
  const choice = extractChoice(input, storyLesson.story.choices);
  const ending = createEnding(choice, storyLesson.story);

  return {
    ...storyLesson,
    id: `story_${Date.now()}`,
    awaitingAnswer: false,
    teachingMove: "child_choice_then_offline_retell",
    story: {
      ...storyLesson.story,
      childChoice: choice,
      ending,
      recap: `${storyLesson.story.character}在${storyLesson.story.setting}发现了${storyLesson.story.object}，最后选择了${choice}。`
    },
    plannerReason: "孩子已经做出选择，故事在这里停住，下一步让孩子画出来或复述给成人听。"
  };
}

function extractChoice(input, choices) {
  const hit = choices.find((choice) => input.includes(choice.replace("的门", "")) || input.includes(choice));
  return hit || choices[0];
}

function createEnding(choice, story) {
  const detail = story.choiceDetails?.find((item) => item.label === choice);
  const ending = detail?.ending || `${story.character}选择了${choice}，故事停在这里，等你画出下一幕。`;
  return applyStoryPattern(ending, {
    character: story.character,
    setting: story.setting,
    object: story.object
  });
}

function applyStoryPattern(template, values) {
  return template
    .replaceAll("{character}", values.character)
    .replaceAll("{setting}", values.setting)
    .replaceAll("{object}", values.object);
}
