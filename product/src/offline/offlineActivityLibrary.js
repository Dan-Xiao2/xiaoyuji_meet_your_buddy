const offlineActivities = {
  "math.subtract_as_takeaway": [
    {
      id: "takeaway_fruit_5",
      title: "水果拿走小游戏",
      domain: "数感",
      screenTime: "AI 互动后离开屏幕 5 分钟",
      purpose: "让孩子用真实物品理解“拿走以后还剩多少”。",
      materials: ["5 个葡萄/积木/小石子", "一个小盘子"],
      steps: [
        "把 5 个物品放在孩子面前，让孩子先数一遍。",
        "请孩子亲手拿走 2 个。",
        "问：现在盘子里还剩几个？",
        "如果孩子重新数一遍，不要打断，记录下来。"
      ],
      adultPrompt: "你可以问：你是怎么看出来还剩这些的？",
      observeFocus: ["是否能亲手完成拿走动作", "是否重新数全部物品", "是否能说出完整句子"],
      memoryTarget: "math.subtract_as_takeaway"
    },
    {
      id: "jump_stop_count",
      title: "跳一跳，停一停",
      domain: "运动 + 数感",
      screenTime: "离开屏幕 5-8 分钟",
      purpose: "把数量变化放进身体动作里，减少屏幕停留。",
      materials: ["一小块安全空地"],
      steps: [
        "请孩子跳 5 下。",
        "说：现在停掉 2 下，剩下几下还没跳？",
        "换成拍手、跺脚或走步再玩一次。"
      ],
      adultPrompt: "你可以问：你刚才是用身体数，还是在脑子里数？",
      observeFocus: ["是否愿意参与运动", "是否需要成人示范", "是否能保持注意力"],
      memoryTarget: "math.subtract_as_takeaway"
    }
  ],
  "language.full_sentence": [
    {
      id: "i_see_sentence",
      title: "我看到了一句话",
      domain: "表达",
      screenTime: "离开屏幕 3-5 分钟",
      purpose: "帮助孩子把一个词扩展成完整表达。",
      materials: ["家里或教室里的任意物品"],
      steps: [
        "让孩子找一个喜欢的东西。",
        "请孩子用“我看到……”开头说一句话。",
        "成人只补充一点点：颜色、位置、动作。"
      ],
      adultPrompt: "你可以问：它在哪里？它是什么颜色？",
      observeFocus: ["是否主动开口", "是否能说完整句", "是否需要成人补词"],
      memoryTarget: "language.full_sentence"
    }
  ],
  story: [
    {
      id: "story_retell_draw",
      title: "故事复述和画一画",
      domain: "故事 + 表达",
      screenTime: "听完故事后离开屏幕 8 分钟",
      purpose: "让孩子把听到的故事变成自己的语言和画面，而不是一直听下去。",
      materials: ["一张纸", "彩笔或蜡笔"],
      steps: [
        "请孩子画出故事里的一个角色或一个物品。",
        "成人问：它在哪里？它发现了什么？",
        "让孩子用一句话讲给家长听。",
        "如果孩子愿意，可以让孩子改一个新的结尾。"
      ],
      adultPrompt: "你可以问：如果你是故事里的小伙伴，你会选哪一扇门？",
      observeFocus: ["是否能复述角色", "是否能说出地点或物品", "是否愿意改编结尾"],
      memoryTarget: "language.full_sentence"
    },
    {
      id: "turn_taking_play",
      title: "轮流玩一玩",
      domain: "社会情绪 + 表达",
      screenTime: "故事后离开屏幕 5-8 分钟",
      purpose: "把故事里的选择转成真实同伴交往，观察孩子是否能表达需要和等待。",
      materials: ["一个孩子感兴趣的小玩具", "成人陪同"],
      steps: [
        "成人先示范一句：我还想玩一下，等会儿给你。",
        "请孩子和成人轮流玩同一个玩具。",
        "轮到别人时，观察孩子能不能等待或说出自己的感受。",
        "结束后问：刚才你用了什么办法？"
      ],
      adultPrompt: "你可以问：如果两个小朋友都想玩这个玩具，可以怎么办？",
      observeFocus: ["是否能说出感受", "是否愿意轮流", "是否需要成人调解"],
      memoryTarget: "language.full_sentence"
    },
    {
      id: "emotion_weather_checkin",
      title: "心情天气小记录",
      domain: "社会情绪 + 表达",
      screenTime: "故事后离开屏幕 3-5 分钟",
      purpose: "帮助孩子把“想家、害怕、不开心”说成成人能理解的一句话。",
      materials: ["纸和笔", "成人陪同"],
      steps: [
        "请孩子选一个天气表示心情：太阳、云、雨、风。",
        "成人示范一句：我现在有点像小雨，因为我想妈妈。",
        "请孩子画一个小天气，或者指给成人看。",
        "成人记录孩子是否能说出感受、原因或需要的帮助。"
      ],
      adultPrompt: "你可以问：你现在像什么天气？你希望大人怎么帮你？",
      observeFocus: ["是否能识别情绪", "是否能表达原因", "是否能接受成人安抚"],
      memoryTarget: "language.full_sentence"
    }
  ],
  science: [
    {
      id: "three_colors_leaf",
      title: "找三种颜色",
      domain: "自然探索",
      screenTime: "离开屏幕 8-10 分钟",
      purpose: "把孩子的好奇心带到真实环境里。",
      materials: ["户外或教室角落", "成人陪同"],
      steps: [
        "找 3 个不同颜色的东西。",
        "让孩子说：我找到了……",
        "问：它们哪里一样，哪里不一样？"
      ],
      adultPrompt: "你可以问：你还想找什么颜色？",
      observeFocus: ["是否主动探索", "是否能比较不同", "是否对自然物感兴趣"],
      memoryTarget: "language.full_sentence"
    },
    {
      id: "same_different_sort",
      title: "一样和不一样",
      domain: "科学 + 分类",
      screenTime: "离开屏幕 5-8 分钟",
      purpose: "让孩子通过真实物品比较颜色、形状、大小或用途。",
      materials: ["3-5 个安全小物品"],
      steps: [
        "把几个物品放在一起。",
        "请孩子找出两个一样的地方。",
        "再请孩子找出一个不一样的地方。",
        "成人记录孩子用的是颜色、形状、大小还是用途来比较。"
      ],
      adultPrompt: "你可以问：它们哪里一样？哪里不一样？",
      observeFocus: ["是否能观察细节", "是否能比较异同", "是否能说出理由"],
      memoryTarget: "language.full_sentence"
    }
  ]
};

export function chooseOfflineActivity({ studentModel, activeLesson, lastAssessment }) {
  const activity = activeLesson?.activity;
  const skill = activeLesson?.skill || lastAssessment?.skill || "language.full_sentence";
  const preferredId = activeLesson?.story?.offlineActivityId;
  const candidates = offlineActivities[activity] || offlineActivities[skill] || offlineActivities.science;
  const needsMovement = studentModel?.engagement?.attentionNotes?.some((note) => note.includes("分心"));
  const selected = findActivityById(preferredId) || (needsMovement ? candidates[candidates.length - 1] : candidates[0]);

  return {
    ...selected,
    assignedAt: new Date().toISOString(),
    sourceSkill: skill,
    reason: buildReason(studentModel, activeLesson, lastAssessment, selected),
    status: "assigned"
  };
}

function findActivityById(id) {
  if (!id) return null;
  return Object.values(offlineActivities)
    .flat()
    .find((item) => item.id === id);
}

export function createInitialOfflineTask() {
  return {
    id: "waiting_for_first_session",
    title: "等待孩子的第一次想法",
    domain: "",
    screenTime: "",
    purpose: "完成一次陪伴后，这里会出现一个和本次对话有关的现实小行动。",
    materials: [],
    steps: [],
    adultPrompt: "",
    observeFocus: [],
    memoryTarget: "language.full_sentence",
    reason: "还没有互动证据。",
    status: "empty"
  };
}

function buildReason(studentModel, activeLesson, lastAssessment, selected) {
  if (lastAssessment) {
    return lastAssessment.correct
      ? `孩子刚才愿意尝试，现在把同一种方法带到真实物品里。`
      : `刚才这个问题还需要一点帮助，用真实物品会更容易看懂。`;
  }

  const interest = studentModel?.profile?.interests?.[0];
  return interest ? `孩子最近喜欢${interest}，从熟悉的兴趣开始会更自然。` : "从身边熟悉的物品开始，孩子更容易参与。";
}
