export const developmentDomains = {
  language: {
    label: "语言",
    goals: ["愿意倾听", "大胆表达", "复述简单情节", "用完整句描述"]
  },
  science: {
    label: "科学",
    goals: ["观察比较", "提出问题", "亲身体验", "发现异同"]
  },
  social: {
    label: "社会",
    goals: ["表达情绪", "理解他人", "做出选择", "尝试合作"]
  },
  art: {
    label: "艺术",
    goals: ["感受美", "自由表现", "画出想象", "创造不同结尾"]
  },
  health: {
    label: "健康",
    goals: ["身体动作", "生活习惯", "安全意识", "情绪安定"]
  }
};

export const dialogicPromptTypes = {
  predict: "猜一猜",
  recall: "说一说",
  relate: "连一连",
  feeling: "想一想",
  create: "变一变"
};

export const storySeeds = [
  {
    id: "moon_rabbit_choice",
    match: ["小兔", "月亮", "星星", "晚上"],
    titlePattern: "{character}和{object}",
    character: "小兔子",
    setting: "月光小路",
    object: "月亮纽扣",
    domains: ["language", "social", "art"],
    scenes: [
      "{character}在{setting}上捡到一颗会发光的{object}。",
      "它听见很小很小的声音说：请帮我找到回家的路。",
      "{character}看见三扇小门，每扇门后面都有不一样的声音。",
      "它想请你帮忙选一扇门。"
    ],
    choices: [
      { label: "红色的门", ending: "{character}听见朋友们的笑声，心里暖暖的。{object}照亮了回家的路。" },
      { label: "蓝色的门", ending: "{character}看见安静的小河，月亮倒在水里，像在轻轻说晚安。" },
      { label: "绿色的门", ending: "{character}闻到青草的味道，发现{object}变成了一颗会发芽的小种子。" }
    ],
    prompts: [
      { type: "predict", text: "你觉得门后面会有什么声音？" },
      { type: "feeling", text: "小兔子有一点害怕时，可以怎么办？" },
      { type: "recall", text: "你能说出谁、在哪里、发现了什么吗？" }
    ],
    offlineActivityId: "story_retell_draw",
    observationFocus: ["是否能做出选择", "是否能说出角色和地点", "是否愿意改编结尾"]
  },
  {
    id: "color_leaf_walk",
    match: ["颜色", "叶子", "自然", "找"],
    titlePattern: "{character}和{object}",
    character: "小刺猬",
    setting: "幼儿园的小花园",
    object: "彩色叶子",
    domains: ["science", "language", "art"],
    scenes: [
      "{character}在{setting}里发现一片红色叶子。",
      "风一吹，又送来一片黄色叶子和一片绿色叶子。",
      "{character}把三片叶子排在一起，发现它们颜色不同，形状也不同。",
      "它想邀请你一起找一找：身边还有哪些颜色？"
    ],
    choices: [
      { label: "找红色", ending: "{character}找到了红色积木、红色杯子和一朵小红花。" },
      { label: "找黄色", ending: "{character}找到了黄色书角、黄色蜡笔和一片小黄叶。" },
      { label: "找绿色", ending: "{character}找到了绿色植物、绿色小车和绿色椅子。" }
    ],
    prompts: [
      { type: "relate", text: "你身边有没有这个颜色？" },
      { type: "recall", text: "刚才出现了哪三种颜色？" },
      { type: "create", text: "你想把这些颜色画成什么？" }
    ],
    offlineActivityId: "three_colors_leaf",
    observationFocus: ["是否主动观察环境", "是否能比较颜色或形状", "是否能用一句话描述发现"]
  },
  {
    id: "dino_body_count",
    match: ["恐龙", "运动", "跳", "数"],
    titlePattern: "{character}的脚印",
    character: "小恐龙",
    setting: "软软的沙地",
    object: "大脚印",
    domains: ["health", "science", "language"],
    scenes: [
      "{character}在{setting}上留下一个{object}。",
      "它往前跳一下，又留下一个脚印。",
      "它想知道自己一共跳了几下，可是数着数着忘记了。",
      "它想请你帮它用身体一起数。"
    ],
    choices: [
      { label: "跳三下", ending: "{character}和你一起跳了三下，然后停下来摸摸自己的膝盖。" },
      { label: "拍三下", ending: "{character}和你一起拍了三下手，声音像小鼓一样。" },
      { label: "走三步", ending: "{character}和你一起慢慢走三步，发现脚印排成了一条线。" }
    ],
    prompts: [
      { type: "relate", text: "你想用跳、拍手还是走路来数？" },
      { type: "recall", text: "你刚才做了几下？" },
      { type: "feeling", text: "运动完身体有什么感觉？" }
    ],
    offlineActivityId: "jump_stop_count",
    observationFocus: ["是否愿意参与身体动作", "是否能跟随节奏", "是否能说出动作次数"]
  },
  {
    id: "sharing_bear",
    match: ["朋友", "分享", "生气", "情绪", "玩具"],
    titlePattern: "{character}和{object}",
    character: "小熊",
    setting: "积木区",
    object: "红色小车",
    domains: ["social", "language", "health"],
    scenes: [
      "{character}在{setting}里找到一辆{object}，它非常喜欢。",
      "小伙伴也想玩，{character}把小车抱得紧紧的。",
      "它心里有点着急，不知道该怎么说。",
      "它想请你帮它想一个办法。"
    ],
    choices: [
      { label: "轮流玩", ending: "{character}说：我先玩一会儿，再给你玩。两个小伙伴都点点头。" },
      { label: "一起修路", ending: "{character}把积木排成路，小伙伴推着小车慢慢开过去。" },
      { label: "说出感受", ending: "{character}说：我还想玩一下。大人听见后，帮它们一起商量。" }
    ],
    prompts: [
      { type: "feeling", text: "小熊现在是什么感觉？" },
      { type: "create", text: "你还能想到什么办法？" },
      { type: "relate", text: "你和朋友想玩同一个玩具时，会怎么说？" }
    ],
    offlineActivityId: "turn_taking_play",
    observationFocus: ["是否能识别情绪", "是否能提出办法", "是否愿意使用礼貌表达"]
  },
  {
    id: "morning_cloud_feelings",
    match: ["妈妈", "爸爸", "想妈妈", "想爸爸", "早上", "入园", "哭", "害怕", "不开心", "安心"],
    titlePattern: "{character}和{object}",
    character: "小云朵",
    setting: "幼儿园门口",
    object: "安心口袋",
    domains: ["social", "language", "health", "art"],
    scenes: [
      "{character}早上来到{setting}，心里有一点点想家。",
      "它摸了摸自己的{object}，里面装着一句悄悄话：我可以慢慢来。",
      "大人蹲下来问：你现在的心情像什么天气？",
      "{character}想请你帮它选一个让自己安心的小办法。"
    ],
    choices: [
      { label: "抱一抱玩偶", ending: "{character}抱着软软的玩偶，深深吸一口气，心里的雨慢慢变小了。" },
      { label: "画给妈妈看", ending: "{character}画了一朵小花，想放学后告诉妈妈：我今天勇敢了一点点。" },
      { label: "找朋友牵手", ending: "{character}找到一个小伙伴，两个人一起走进教室，脚步变轻了。" }
    ],
    prompts: [
      { type: "feeling", text: "小云朵现在是什么感觉？" },
      { type: "relate", text: "你早上想家时，什么办法会让你安心一点？" },
      { type: "create", text: "你想给安心口袋里放一句什么话？" }
    ],
    offlineActivityId: "emotion_weather_checkin",
    observationFocus: ["是否能说出情绪", "是否能选择安定办法", "是否愿意把感受告诉成人"]
  }
];

export function pickStorySeed(input, studentModel) {
  const interests = studentModel?.profile?.interests || [];
  const directHit = rankSeedMatches(storySeeds, input)[0]?.seed;
  if (directHit) return directHit;

  const interestText = interests.join(" ");
  return rankSeedMatches(storySeeds, interestText)[0]?.seed || storySeeds[0];
}

function rankSeedMatches(seeds, text) {
  return seeds
    .map((seed) => {
      const matchedWords = seed.match.filter((word) => text.includes(word));
      const specificity = matchedWords.reduce((sum, word) => sum + word.length, 0);
      return { seed, score: matchedWords.length * 10 + specificity };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function getDomainLabels(domainKeys = []) {
  return domainKeys.map((key) => developmentDomains[key]?.label || key);
}

export function getContentPrinciples() {
  return [
    "短互动，不追求连续沉浸。",
    "孩子要参与选择、预测和复述。",
    "每个故事都连接现实活动。",
    "成人记录的是观察到的事实，不给孩子贴标签。",
    "内容覆盖语言、科学、社会、艺术、健康五大领域。"
  ];
}
