# Student Memory Architecture

本文件是 `docs/product-framework.md` 的记忆层落地说明。小宇记与通用聊天产品拉开差异的核心，不是保存更多聊天记录，而是在家长可控的前提下维护一个基于证据、可以修正的结构化 Student Model。

## 目标链路

```text
Child Profile + Student DB
  ↓
Student Model
  ↓
Interaction Planner
  ↓
Companion Agent
  ↓
Tools
  ├── Voice
  ├── Whiteboard
  ├── Story
  ├── Offline activity
  └── Optional learning tools
  ↓
Child
  ↓
New evidence + Parent summary
```

## 三层记忆

### 1. Raw Evidence

原始证据用于成长记录、模型更新和误判检查。保存范围必须由家长控制。

- 孩子的原话、问题、选择或答案
- AI 回复和本轮使用的白板内容
- 会话时间、是否请求提示、是否中途退出
- 孩子是否完成现实活动
- 家长主动补充的观察
- 家长手动附加到具体成长片段的照片和说明
- 证据来源、时间和所属会话

对应表包括：

- `lesson_sessions`
- `lesson_questions`
- `student_answers`
- `student_events`
- `offline_activity_assignments`
- `offline_observations`
- `error_classifications`，仅用于确实存在答案判断的任务

原始证据不等于永久保存完整录音。第一版默认不保存连续原始音频，只保存完成产品功能所需的最少文本和结构化事件。

### Growth Moment

Growth Moment 是产品中可回看、可珍藏的最小成长单位。它不能只是一段自动摘要，至少要保留日期、原始证据和家长控制状态：

```json
{
  "id": "moment_123",
  "observedAt": "2026-08-23T18:10:00Z",
  "childQuote": "月亮是不是每天都换衣服？",
  "topics": ["月亮", "变化"],
  "domains": ["science", "language"],
  "sourceSessionId": "session_123",
  "boardSnapshotId": "board_123",
  "parentNote": "最近每天回家都会找月亮",
  "attachments": [
    {
      "id": "attachment_123",
      "type": "image",
      "storage": "local",
      "caption": "晚上一起观察月亮",
      "addedBy": "parent"
    }
  ],
  "starred": true
}
```

照片附件尚未在 `schemaVersion: 3` 中实现。下一版本必须只允许家长主动选择，支持压缩、预览、移除、导出和随 Growth Moment 删除；不得由 Agent 向孩子索要照片，也不做人脸识别或自动扫描相册。

长期系统应保留 Growth Moments 的时间顺序，再从多个片段中总结兴趣首次出现、反复出现、淡出或转变。不能只更新并覆盖一个“当前兴趣”字段。

### 2. Structured Student Model

长期模型用于调整后续陪伴方式，不用于给孩子排名或下诊断。

- recurring interests and questions
- expression and exploration signals
- support observations
- recent wins and attempts
- offline activity evidence
- optional knowledge mastery and misconceptions
- evidence-backed trajectories

对应表包括：

- `student_interests`
- `learning_style_observations`
- `behaviour_metrics`
- `student_skill_mastery`
- `student_misconceptions`
- `mastery_snapshots`

现有数据库表名保留了早期“学习模型”的结构，但当前产品应优先写入兴趣、原话、表达证据、现实探索和支持方式。只有在明确的知识任务中，才更新 mastery 或 misconception。

### 3. Active Companion Context

每次调用 Companion Agent 前，从数据库压缩出少量、具体、可执行的上下文：

```text
Child: 安安, 4-5
Recent topic: 今天和新朋友搭积木
Interest evidence: 最近三次都主动提到建造和动物
Expression evidence: 在一个提示后能补充人物和地点
Support observation: 短问题比长解释更容易让孩子继续
Next move: 先复述孩子原话，再问一个具体细节
Do not: 把“交到新朋友”写成未经确认的事实
```

上下文应该短、具体、可执行。Agent 不应读取全量历史，也不能把旧记忆生硬地塞进每次对话。

## 证据和推测必须分开

推荐为每条结构化线索保留以下信息：

```json
{
  "signal": "愿意补充人物和地点",
  "sourceType": "child_utterance",
  "sourceSessionId": "session_123",
  "observedAt": "2026-08-23T18:10:00Z",
  "confidence": 0.72,
  "evidenceCount": 2,
  "status": "emerging",
  "confirmedByParent": false
}
```

- `sourceType` 说明来自孩子原话、家长观察、系统事件还是模型推测。
- `confidence` 只能表示系统判断的不确定性，不是孩子能力分数。
- `evidenceCount` 防止一次行为被写成长久结论。
- `confirmedByParent` 允许家长确认或修正重要信息。

## 研究依据的成长阶段观察

成长阶段观察建立在 Raw Evidence 和 Structured Student Model 之上，不是独立的 AI 评分。0-3 岁与 3-6 岁应使用不同的资料来源和年龄分段，但输出统一为家长可理解、非排名的阶段语言。

```json
{
  "domain": "language_expression",
  "signalKey": "uses_causal_expression",
  "stage": "stabilizing",
  "label": "逐渐稳定",
  "ageBand": "4-5",
  "reference": {
    "sourceId": "moe-3-6-guideline",
    "version": "2012",
    "applicableAge": "4-5"
  },
  "evidenceMomentIds": ["moment_101", "moment_112", "moment_128"],
  "evidenceCount": 3,
  "firstObservedAt": "2026-07-12T18:10:00Z",
  "lastObservedAt": "2026-08-23T18:10:00Z",
  "confirmedByParent": false,
  "guidance": "这周可以请孩子用‘因为……所以……’解释一次自己的选择。"
}
```

允许的 `stage` 为：`emerging`、`practicing`、`stabilizing`、`frequent`、`insufficient_evidence`。这些值只描述现有记录中的表现，不能解释为医学结论、能力分数或同龄百分位。

每条阶段观察必须满足：

1. 引用明确的资料来源、版本和适用年龄。
2. 链接多条可查看的 Growth Moments，不能只依据一次对话。
3. 把孩子原话、家长观察和模型推测分开。
4. 允许家长确认、修正、排除和删除。
5. 输出一个低负担家庭活动；如持续出现值得关注的信号，只建议携带记录咨询专业人员。

## 设计原则

1. 不把完整聊天记录当作唯一核心资产。
2. 只在有可靠信号时产生结构化证据，不能为了填满字段而推断。
3. 孩子原话、家长观察和模型推测必须分开保存并标明来源。
4. 一次行为不能直接变成长期趋势。
5. 学习风格、行为和情绪只能作为暂时观察，不能形成固定标签。
6. 儿童数据默认最小化，MVP 只保存完成体验所需的匿名昵称、年龄段和成长证据。
7. Companion Agent 只读取必要上下文，不直接读取全量数据库。
8. 家长能够查看、修正、下载和删除成长记录。
9. 删除孩子档案时，应能删除关联证据和派生模型，而不只删除页面显示。
10. 时间线摘要必须能链接回支持它的 Growth Moments。

## 不只记录对错

对于幼儿，很多高价值信号不是“正确或错误”，而是：

- 是否主动提出问题
- 是否愿意补充细节
- 是否能描述人物、地点和过程
- 是否尝试不同办法
- 需要多少提示才继续
- 是否把屏幕中的想法带到现实活动
- 是否愿意回来讲述自己的发现

当孩子确实进入数学或知识理解任务时，可以使用错误分类：

```json
{
  "correct": false,
  "errorType": "recounted_instead_of_takeaway",
  "misconceptionKey": "subtract_as_takeaway",
  "confidence": 0.84,
  "recommendedAction": "show_objects_and_ask_one_question"
}
```

错误分类可以影响下一次解释和白板内容，但不应扩展成对孩子整体能力的判断。

## 线下证据

小宇记不能只看屏幕内表现。每次短互动可以生成一个现实活动，并由家长提交轻量观察：

```json
{
  "offlineTask": "找三种不同颜色",
  "completion": "completed",
  "support": "some_support",
  "behaviour": "described_difference",
  "notes": "孩子自己找到了叶子和杯子，还说出了哪里不一样。"
}
```

线下观察可以影响：

- interest signals
- expression and exploration signals
- optional skill mastery
- next interaction suggestion
- parent summary

家长观察是证据的一部分，不是给孩子完成打卡任务。

## 当前本地实现

当前版本尚未连接 Supabase，但已经有可替换的数据边界：

- `src/student/studentSchema.js`
- `src/student/lessonPlanner.js`
- `src/student/memoryUpdater.js`
- `src/student/masteryModel.js`
- `src/student/offlineObservationUpdater.js`
- `src/data/localStudentDb.js`

本地数据保存在浏览器 `localStorage`。当前 `schemaVersion: 3` 已把每次有效互动保存为 Growth Moment，包含孩子原话、小宇回应、日期、会话 ID、主题、成长领域、白板精简快照、来源模型、结构化 evidence、置信度、回看资格和家长珍藏状态；旧版 `conversationMoments` 与 v2 Growth Moments 会在读取时自动迁移。

新用户 Student Model 的兴趣、掌握度、误区和成长亮点全部为空。旧版演示种子只会在没有真实 evidence 时被定向清除。Qwen 的 `growthEvidence.sourceQuote` 必须逐字来自本轮孩子输入；本地校验不通过时会回退到完整孩子原话。

家长启动会创建 session，所有 Growth Moments 都关联 session ID；结束后只基于该 session 的片段生成标题、代表原话、主题和继续沟通问题。跨周回看由 `src/data/growthInsights.js` 生成，并保留回到原始 Growth Moment 的链接。

页面“导出”会把 UI 状态、Student Model、学习事件和 Growth Moments 一起下载为完整本地成长档案。它适合 Demo 和小规模单设备试用，但不等于跨设备备份：清理浏览器数据、换手机或设备损坏仍可能丢失未导出的记录。未来接 Supabase 时，优先替换 `src/data/localStudentDb.js` 和服务端数据接口，不要把数据库调用散落在 UI 组件中。

## Voice-first 前提

```text
家长启动一次陪伴
  ↓
孩子点语音按钮并自然说话
  ↓
AI 语音回应 + 按需白板辅助
  ↓
孩子去画、找、搭、说或运动
  ↓
家长收到一条摘要和继续沟通提示
```

文字输入只作为成人备用工具。正式产品中，语音识别、语音合成和安全过滤应通过可信后端或实时语音服务统一处理。

## 下一步

1. 为“孩子原话”“模型推测”“家长观察”建立不同的展示和编辑方式。
2. 让家长可以给 Growth Moment 添加备注、确认、修正和删除，而不只是珍藏或下载。
3. 给 Growth Moment 增加家长手动照片附件，并保证附件可随记录完整导出和删除。
4. 建立 0-3 岁与 3-6 岁资料来源表、阶段信号表和证据门槛，先输出 `insufficient_evidence` 而不是勉强生成结论。
5. 让 Agent 每次会话前只读取 compact Student Model。
6. 接 Supabase 前完成彻底删除、第三方模型调用说明和跨设备恢复。
7. 用第二次、第三次真实互动测试记忆是否真正改善陪伴，而不只是重复旧话题。
8. 用同一批家庭进行跨周验证，确认自动回看和阶段观察是否真的值得家长保存、理解且不会制造焦虑。
