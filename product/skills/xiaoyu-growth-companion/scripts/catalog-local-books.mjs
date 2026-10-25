import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_DIR = process.argv[2];
const OUTPUT_DIR = process.argv[3] || path.resolve("references");

if (!SOURCE_DIR) {
  throw new Error("用法: node scripts/catalog-local-books.mjs <电子书目录> [输出目录]");
}

const AGE_LABELS = {
  prenatal: "孕期与产后准备（当前产品暂缓）",
  "0-1": "0-1 岁",
  "1-3": "1-3 岁",
  "3-6": "3-6 岁",
  "0-3": "0-3 岁跨阶段",
  "0-6": "0-6 岁跨阶段",
  "6+": "6 岁以上（当前产品暂缓）",
  parent: "家长通识与亲子关系（跨年龄）",
  reference: "专业与安全参考（需版本复核）",
  story: "故事与活动素材（只作灵感）",
  unrelated: "非当前育儿知识范围",
  review: "待阅读确认"
};

const GROUP_ORDER = [
  "0-1",
  "1-3",
  "3-6",
  "0-3",
  "0-6",
  "parent",
  "reference",
  "story",
  "prenatal",
  "6+",
  "unrelated",
  "review"
];

const CORE_RULES = [
  ["美国儿科学会育儿百科第6版", "0-6 岁健康与安全参考；优先核对版次和中文版出版信息"],
  ["美国儿科学会育儿百科  0-5岁", "0-5 岁健康与安全参考；可与第6版比较后只保留较新版本"],
  ["丁香妈妈科学养育：百位医生", "中国家庭常见健康与照护问题；医学内容仍需官方来源交叉核对"],
  ["从出生到三岁", "明确覆盖 0-3 岁能力发展与早期互动"],
  ["你的1岁2岁3岁孩子", "按年龄理解行为差异，适合建立 1-3 岁家长辅助模式"],
  ["父母的语言", "适合提炼回应式语言互动原则，不复制原书表达"],
  ["儿童发展心理学", "用于建立发展理论背景，不直接生成个体结论"],
  ["婴幼儿睡眠全书", "高频家庭场景；只做非诊疗型睡眠习惯内容"],
  ["全脑教养法", "亲子沟通与情绪支持参考，需要与当前研究交叉核对"],
  ["游戏力-", "游戏化连接与现实活动设计参考"],
  ["陪孩子走过幼儿园三年", "3-6 岁入园、安全感与家庭陪伴场景"],
  ["孩子绘画的秘密", "3-6 岁艺术表达观察；避免把画作解释成心理诊断"],
  ["真正的蒙氏教育在家庭  50个经典语言游戏", "3-6 岁语言活动灵感；只吸收原则，不复制练习"],
  ["真正的蒙氏教育在家庭  50个经典探索游戏", "3-6 岁现实探索活动灵感；只吸收原则，不复制练习"],
  ["养育有安全感的孩子", "依恋与安全感主题，可支持家长回应方式"],
  ["捕捉儿童敏感期", "中国家庭熟悉的观察框架；只能作观点线索，不能当作发展量表"],
  ["1000天阅读效应", "早期亲子阅读与语言环境的产品场景参考"],
  ["如何培养孩子的社会能力", "适合 3-6 岁同伴互动和问题解决活动"],
  ["善解童贞", "儿童身体与性教育参考；必须进行年龄、安全和专业复核"],
  ["崔玉涛图解家庭育儿8小儿生长发育", "0-3 岁生长发育参考；版本和医学建议需复核"]
];

const UNRELATED_PATTERNS = [
  "疯传",
  "煤气灯效应",
  "亲密关系：通往灵魂",
  "洛克菲勒留给儿子",
  "富爸爸_穷爸爸",
  "面试热点",
  "在共产主义旗帜下",
  "指南单页",
  "100+电子书_文件目录",
  "性格的陷阱",
  "运动改造大脑"
];

const MEDICAL_PATTERNS = [
  "儿科学会",
  "儿科",
  "医生",
  "看病",
  "常见病",
  "发热",
  "过敏",
  "疫苗",
  "肠道",
  "口腔",
  "营养",
  "辅食",
  "喂养",
  "睡眠",
  "健康",
  "生长发育",
  "中医",
  "乙肝",
  "护理"
];

const EDUCATION_PATTERNS = [
  "学习",
  "教育",
  "启蒙",
  "游戏",
  "绘画",
  "阅读",
  "蒙台梭利",
  "蒙氏",
  "语言",
  "数学",
  "探索",
  "认知",
  "社会能力"
];

const RELATIONSHIP_PATTERNS = [
  "亲子",
  "父母",
  "爸爸",
  "妈妈",
  "养育",
  "管教",
  "教养",
  "安全感",
  "接纳",
  "情绪",
  "幸福",
  "沟通",
  "孩子，把你的手给我",
  "读懂孩子",
  "看见孩子",
  "孩子到底",
  "孩子挑战",
  "你的孩子",
  "你就是孩子",
  "奖励的恶果",
  "反溺爱",
  "逆反心理",
  "孩子才会听",
  "孩子才肯说",
  "心理抚养",
  "爱和自由",
  "在远远的背后带领",
  "育儿基本",
  "陪孩子终身成长",
  "如何让孩子自觉",
  "为何家会伤人",
  "爱、金钱和孩子",
  "经济学家的育儿",
  "育儿的逻辑",
  "育儿乱象",
  "来自全世界的育儿经"
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function includesAny(title, patterns) {
  return patterns.some((pattern) => title.includes(pattern));
}

function normalizeTitle(fileName) {
  return fileName
    .replace(/\.(pdf|epub|mobi|azw3|txt)$/i, "")
    .replace(/[【】\[\]《》“”‘’()（）]/g, "")
    .replace(/扫描版|高清版|文字版|全彩|标注版|典藏版|修订版|全新修订第?\d*版|最新第?\d*版|第\d+版/gi, "")
    .replace(/_?\d{7,}/g, "")
    .replace(/\s+/g, "")
    .replace(/[._~—-]+/g, "")
    .toLowerCase();
}

function inferAgeGroup(title) {
  if (includesAny(title, UNRELATED_PATTERNS)) return ["unrelated", "标题明确不属于当前 0-6 岁成长陪伴知识范围", "high"];
  if (/怀孕|妊娠|分娩|备孕|孕产|胎儿|月子|产后|准爸爸|生个/.test(title)) return ["prenatal", "标题指向孕期、分娩或产后准备", "high"];
  if (/青春期|常春藤|学霸|作业|自律|自驱|时间管理|费曼|英语学习规划师|如何说孩子才肯学|学习法/.test(title)) return ["6+", "标题主要指向学龄或青春期任务", "medium"];
  if (/365夜|睡前故事|益智故事馆|宝宝的快乐生活/.test(title)) return ["story", "以故事或素材内容为主，不作为发展证据", "high"];
  if (/0[-～—至]12月|0[-～—至]1岁|婴儿游戏|新生儿/.test(title)) return ["0-1", "标题明确标注 0-1 岁或新生儿阶段", "high"];
  if (/1[-～—至]3岁|1岁2岁3岁|1～2|2～3|可怕的两岁|海蒂育儿大百科\s*1-3岁/.test(title)) return ["1-3", "标题明确标注 1-3 岁或两岁阶段", "high"];
  if (/3[-～—至]6岁|幼儿园三年|幼儿园|幼儿绘画|3岁对了/.test(title)) return ["3-6", "标题明确指向幼儿园或 3-6 岁阶段", "high"];
  if (/0[-～—至]3岁|从出生到三岁|婴幼儿|育婴|婴儿卷|幼儿卷|宝宝|1000天|辅食|母乳|配方粉|程序育儿|睡前育儿|关灯就睡觉|儿保专家/.test(title)) return ["0-3", "标题主要覆盖婴幼儿或 0-3 岁照护", "medium"];
  if (/0[-～—至]6岁|0[-～—至]5岁|儿童发展心理学|儿童教育心理学|敏感期|完整的成长|童年的秘密|蒙台梭利|蒙氏|游戏力|全脑教养|社会能力|性教育|善解童贞|关键期|早教智慧书|园丁与木匠|培养孩子的英文耳朵|从小读到大|七田真|天才儿童/.test(title)) return ["0-6", "标题覆盖多个学前发展阶段或通用儿童发展主题", "medium"];
  if (includesAny(title, MEDICAL_PATTERNS) || /育儿百科|育儿全书|育儿手册|科学育儿|育儿知识|育儿宝典|育儿生活|西尔斯|斯波克|张思莱|崔玉涛|超级育儿师/.test(title)) return ["reference", "健康、照护或百科类资料，必须核对版本与专业依据", "medium"];
  if (includesAny(title, RELATIONSHIP_PATTERNS)) return ["parent", "标题主要讨论家长观念、亲子关系或沟通", "medium"];
  if (includesAny(title, EDUCATION_PATTERNS)) return ["0-6", "可能适用于学前教育或活动设计，需阅读目录确认年龄", "low"];
  return ["review", "仅凭书名无法可靠判断适用年龄", "low"];
}

function inferContentType(title, group) {
  if (group === "story") return "story_material";
  if (group === "prenatal") return "prenatal_and_postpartum";
  if (group === "unrelated") return "out_of_scope";
  if (includesAny(title, MEDICAL_PATTERNS) || /育儿百科|育儿全书|育儿手册|科学育儿/.test(title)) return "health_and_care";
  if (/心理学|心理|情绪|安全感|依恋|性格/.test(title)) return "development_and_emotion";
  if (includesAny(title, EDUCATION_PATTERNS)) return "play_language_and_learning";
  if (includesAny(title, RELATIONSHIP_PATTERNS)) return "parent_child_relationship";
  return "general_parenting";
}

function inferReviewStatus(title, group) {
  if (group === "unrelated" || group === "prenatal" || group === "6+") return "defer_out_of_scope";
  if (/1985|1990|1993|2000|中医|百岁医师|百岁医生|七田真|天才儿童|3岁对了，一辈子/.test(title)) return "hold_for_evidence_review";
  if (includesAny(title, MEDICAL_PATTERNS)) return "hold_for_medical_and_version_review";
  if (group === "review") return "needs_manual_review";
  return "candidate_for_internal_summary";
}

function findShortlist(title) {
  const match = CORE_RULES.find(([pattern]) => title.includes(pattern));
  return match ? match[1] : null;
}

function escapeMarkdown(value) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const sourceStat = await stat(SOURCE_DIR);
if (!sourceStat.isDirectory()) throw new Error(`${SOURCE_DIR} 不是目录`);

const allPaths = (await walk(SOURCE_DIR)).sort((a, b) => a.localeCompare(b, "zh-CN"));
const supportedPaths = allPaths.filter((filePath) => /\.(pdf|epub|mobi|azw3|txt)$/i.test(filePath));

const books = [];
for (const fullPath of supportedPaths) {
  const relativePath = path.relative(SOURCE_DIR, fullPath);
  const fileName = path.basename(fullPath);
  const title = fileName.replace(/\.(pdf|epub|mobi|azw3|txt)$/i, "");
  const fileStat = await stat(fullPath);
  const [ageGroup, ageReason, confidence] = inferAgeGroup(title);
  const shortlistReason = findShortlist(title);
  books.push({
    id: `LOCAL-BOOK-${String(books.length + 1).padStart(3, "0")}`,
    title,
    relativePath,
    extension: path.extname(fileName).slice(1).toLowerCase(),
    sizeBytes: fileStat.size,
    ageGroup,
    ageLabel: AGE_LABELS[ageGroup],
    ageReason,
    classificationBasis: "filename_only",
    confidence,
    contentType: inferContentType(title, ageGroup),
    reviewStatus: inferReviewStatus(title, ageGroup),
    shortlistReason,
    normalizedTitle: normalizeTitle(fileName),
    copyrightPolicy: "internal_research_only_no_commercial_derivative_until_license_verified"
  });
}

const titleGroups = new Map();
for (const book of books) {
  if (!titleGroups.has(book.normalizedTitle)) titleGroups.set(book.normalizedTitle, []);
  titleGroups.get(book.normalizedTitle).push(book.id);
}

let duplicateGroupCount = 0;
for (const ids of titleGroups.values()) {
  if (ids.length < 2) continue;
  duplicateGroupCount += 1;
  const groupId = `DUP-${String(duplicateGroupCount).padStart(3, "0")}`;
  for (const id of ids) {
    const book = books.find((item) => item.id === id);
    book.possibleDuplicateGroup = groupId;
  }
}

const countsByAgeGroup = Object.fromEntries(GROUP_ORDER.map((group) => [group, books.filter((book) => book.ageGroup === group).length]));
const shortlist = books
  .filter((book) => book.shortlistReason)
  .sort((a, b) => GROUP_ORDER.indexOf(a.ageGroup) - GROUP_ORDER.indexOf(b.ageGroup) || a.title.localeCompare(b.title, "zh-CN"));

const catalog = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  sourceRootName: path.basename(SOURCE_DIR),
  sourceFilesWereModified: false,
  classificationScope: "第一轮仅依据文件名分类；正式吸收前必须阅读版权页、目录和相关章节并交叉核对权威来源",
  totalFiles: allPaths.length,
  supportedBookFiles: books.length,
  possibleDuplicateGroups: duplicateGroupCount,
  countsByAgeGroup,
  books
};

const summaryLines = [
  "# 本地育儿电子书分龄目录",
  "",
  `> 生成日期：${new Date().toISOString().slice(0, 10)}  `,
  `> 来源目录：\`${path.basename(SOURCE_DIR)}\`（原文件未移动、未改名、未复制进仓库）  `,
  "> 重要：本轮分类只依据文件名。商业出版物只能供内部研究、原创摘要和线索检索；未核实授权前，不把全文、扫描页、表格、案例或练习放入 Skill、向量库、提示词或训练集。",
  "",
  "## 总览",
  "",
  `- 共发现 ${books.length} 个可识别电子书文件。`,
  `- 发现 ${duplicateGroupCount} 组疑似同书异版或重复文件；这是书名近似判断，不等于内容完全相同。`,
  `- 短名单有 ${shortlist.length} 个文件版本；同一本书的多个版本应在精读前合并。`,
  "- 健康、营养、睡眠、疾病和发育内容默认进入专业/版本复核，不直接驱动面向家长或孩子的回答。",
  "",
  "| 分类 | 文件数 |",
  "|---|---:|",
  ...GROUP_ORDER.map((group) => `| ${AGE_LABELS[group]} | ${countsByAgeGroup[group]} |`),
  "",
  "## 第一批精读短名单",
  "",
  "先核对版权页、版次、目录和相关章节，再决定是否写原创知识卡。这里的“短名单”不代表该书本身是临床或教育标准。",
  "",
  "| 年龄 | 书名 | 为什么先看 | 处理要求 |",
  "|---|---|---|---|",
  ...shortlist.map((book) => `| ${book.ageLabel} | ${escapeMarkdown(book.title)} | ${escapeMarkdown(book.shortlistReason)} | ${book.reviewStatus} |`),
  "",
  "## 完整分龄目录",
  "",
  ...GROUP_ORDER.flatMap((group) => {
    const groupBooks = books.filter((book) => book.ageGroup === group);
    if (groupBooks.length === 0) return [];
    return [
      `### ${AGE_LABELS[group]}（${groupBooks.length}）`,
      "",
      "| ID | 书名 | 类型 | 建议 | 置信度 | 疑似重复 | 大小 |",
      "|---|---|---|---|---|---|---:|",
      ...groupBooks.map((book) => `| ${book.id} | ${escapeMarkdown(book.title)} | ${book.contentType} | ${book.reviewStatus} | ${book.confidence} | ${book.possibleDuplicateGroup || "-"} | ${formatBytes(book.sizeBytes)} |`),
      ""
    ];
  }),
  "## 下一步吸收规则",
  "",
  "1. 先处理短名单中的非医学主题：语言互动、游戏、情绪支持、幼儿园适应和现实探索。",
  "2. 医疗、营养、睡眠、疾病、筛查和发育里程碑只用来寻找问题与关键词；最终规则必须回到中国现行官方指南或专业共识。",
  "3. 每本书最多先产出一页原创评审：核心主张、适用年龄、可吸收原则、争议/过时风险、可转成的产品行为、明确不能使用的内容。",
  "4. 只有通过来源与版权评审的原则，才写入 `knowledge-cards.json`；本地电子书本身不进入运行时。",
  "5. 7-13 岁、孕产和无关书目保留索引但不进入当前 0-6 岁 MVP。",
  ""
];

await writeFile(path.join(OUTPUT_DIR, "local-parenting-book-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
await writeFile(path.join(OUTPUT_DIR, "local-parenting-book-catalog.md"), `${summaryLines.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  totalFiles: allPaths.length,
  supportedBookFiles: books.length,
  possibleDuplicateGroups: duplicateGroupCount,
  shortlistFiles: shortlist.length,
  countsByAgeGroup,
  outputs: [
    path.join(OUTPUT_DIR, "local-parenting-book-catalog.json"),
    path.join(OUTPUT_DIR, "local-parenting-book-catalog.md")
  ]
}, null, 2));
