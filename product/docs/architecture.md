# MVP 文件架构说明

这个项目先用“本地可运行的小产品骨架”来表达产品逻辑，而不是只做一个静态展示页。

当前组件关系、主链路和数据边界已经同步为可交互架构图：

- `docs/architecture/xiaoyuji-runtime.architecture.html`：可查看、搜索和聚焦链路的展示文件。
- `docs/architecture/xiaoyuji-runtime.architecture.json`：可版本控制、可验证的架构真相源。
- `docs/architecture/README.md`：何时更新、如何校验和生成。

产品边界和优先级以 `docs/product-framework.md` 为准。技术模块不能反过来决定孩子和家长必须看到什么。

## 核心结构

- `index.html`：页面入口，和共享导航一起呈现一起聊、成长记录、家庭设置、备份记录四个视图。
- `src/bootstrap.js`：先检查档案和备用快照，再加载app；数据无法读取时进入恢复页，不启动正常对话。控件在初始化完成前不可操作。
- `src/app.js`：浏览器组合入口，连接页面事件、语音、绘图和成长记录；仍有可写 state 及绘图异步协调，尚未成为仅装配的入口。
- `src/app/appStore.js`、`src/app/applicationState.js`：提交时“规范化 → 保存 → 渲染”；已移除 renderFamilyControls 的 family 赋值，但 render 仍读取档案库，尚未验收整个渲染链为纯视图。
- `src/features/conversation/conversationController.js`：一轮文本对话的开始、取消、快速回复、后台补全和迟到结果丢弃；通过getState读取最新状态，异步结果使用conversationCommit限定字段。同步pending、内部计算及HTTP协议仍使用状态对象。
- `src/features/conversation/conversationState.js`：对话状态的纯函数，只处理待回答、已说出口回复和受限后台补全。
- `src/features/drawing/drawingState.js`：绘图回合字段合并、会话/基图检查及过期结果反馈；本机画面变更序号在每次提交时更新，撤销回旧模型版本也会使原请求过期。它不是持久化版本库或第二份可写画面。
- `src/data/activities.js`：学习活动和示例 prompt。
- `src/data/studentModel.js`：孩子档案、兴趣、成长证据和必要学习信号的初始结构。
- `src/data/familyModel.js`：固定 1 个主孩子档案，另有最多 6 位家长/照护者、当前说话人和手动身份确认状态；不伪装成自动音色识别。
- `src/data/localStudentDb.js`：本地 Student DB 适配层，未来可以替换成 Supabase。
- `src/session/sessionManager.js`：家庭自由开始、结束会话和本次证据摘要；不设置计划结束时间或自动倒计时。
- `src/session/enrichmentState.js`：补全仅合并 memory/studentModel/growthEvidence 和模型状态，不替换 messages/board。前三个字段与请求开始时的序列化快照比较，有并发修改则保留本地字段；不是逐条证据合并，冲突的后台补全会丢弃。
- `src/data/growthInsights.js`：按周/月整理领域、兴趣轨迹和“以前与现在”，输出原始 evidence ID。
- `src/student/`：结构化 Student Model、证据更新、误区判断和互动规划。掌握度只用于确实存在知识任务的场景。
- `src/services/tutorEngine.js`：当前的陪伴 Agent 本地逻辑。以后接真实大模型时，主要替换这里。
- `src/services/llmClient.js`：前端和后端 API 的连接层。现在有本地 fallback。
- `src/services/safety.js`：儿童隐私和安全边界。
- `src/services/storage.js`：同步缓存、清空和导出。
- `src/services/archiveIntegrity.js`：区分缺失与损坏，统一主键/旧键的读取及基础结构校验；不把损坏数据伪装成新家庭，不是全量语义审计。
- `src/services/localPersistence.js`：档案成对替换的回滚日志与代次检查；显式恢复入口允许替换损坏日志，失败时保留原日志。代次拦截旧页面，不提供跨标签页原子锁。
- `src/services/indexedArchive.js`：整包IndexedDB备用快照及保存状态通知；只有同步缓存完整缺失且代次匹配时自动恢复，不覆盖损坏内容、不逐键混合。仍以localStorage为主，不是分条事务库或跨设备备份。
- `src/ui/archiveRecovery.js`：仅本机下载原始恢复文件、选择并校验完整备份、预览后确认替换；普通app在恢复成功前不加载。
- `src/ui/whiteboard.js`：视觉白板怎么画。
- `src/whiteboard/visualPlan.js`：分积木试点的共享声画计划和白板相关性边界，前后端复用纯函数。
- `src/ui/blockScene.js`：Konva 积木对象、分段移动、点数与实例清理。
- `src/whiteboard/illustrationPlan.js`、`src/ui/illustrationScene.js`：明确画图请求、能力声明和受控简笔对象，家长/孩子均可使用；不支持任意模型路径。
- `src/services/conversationIntent.js`：只有明确答案进入旧练习，新话题不再被判题或关闭Qwen。
- `server/scienceContext.mjs`：太阳的有限事实上下文和已知错误回退，不是通用事实校验。
- `src/ui/chat.js`：对话消息怎么显示。
- `src/ui/memoryPanel.js`：成长足迹和对话珍藏面板。
- `src/ui/summary.js`：家长摘要和继续沟通提示。
- `src/styles/`：页面样式，分成基础、组件、响应式。
- `server/server.mjs`：本地服务，提供 Tutor、ASR、流式 TTS 和整段 TTS 回退接口。
- `server/speechStream.mjs`：通过 eventsource-parser 解码 Qwen SSE，将 PCM 分块转发至 `/api/speech/stream`；取消和超时会中止上游请求。
- `src/services/pcmPlayer.js`：在 Web Audio 时间线上连续调度 PCM，支持首段即播和清空待播队列。
- `src/services/voiceService.js`：录音、ASR、播报、浏览器回退与分阶段耗时；ASR 仍为录完上传。
- `supabase/`：Supabase-ready 数据库 schema、样例数据、权限策略和查询。

## 已接入的 AI 与语音链路

分积木试点在安全和说话人检查后由本地确定性计划处理，跳过下面两次独立文本生成。讲解和积木动作来自同一组步骤；分段TTS实际开始时触发动作，场景快照进入本地成长片段。其他对话仍走Qwen；不支持的图示保持空白。范围和未完成项见 `docs/whiteboard-interaction-plan.md`。

短回答先调用 `/api/tutor/quick`；短回答确定并交给流式 TTS 后，`conversationController` 再调用 `/api/tutor` 补充结构化证据，不发布白板。补全尝试更新同一个 Growth Moment，不替换已说出口的回答。播报结束约 200ms 后可重新倾听，不等待后台补全。新问题、麦克风切换、数据恢复/清空、结束会话和页面关闭会取消当前轮次；控制器还检查 session ID。片段补全需匹配已保存revision/sessionId；记录缺失、家长已修订或版本变化时不写入。恢复/清空后的旧页面保存会被代次检查拒绝，但同代次跨标签页并发和全部派生数据删除仍未完成。

绘图route/plan等待时不再回写整份旧localTurn；接收时合并允许字段。基图已变化则保留当前图，说明此次没有继续修改，不自动追加付费请求。开放图片仍可跨普通聊天轮次完成，但发布需匹配任务、会话和基图；失败只更新提示、不恢复旧图。绘图路由判为普通聊天时，pending阶段保留当前有效白板，并把路由阶段证据冲突带入后续补全。

TTS 首选 `/api/speech/stream`：Qwen SSE → 服务端 PCM → 浏览器 Web Audio。首段前失败可回退 `/api/speech` 的同音色 MP3；两条云路径都失败时显示原回答和重播入口，不突然切换浏览器系统音色。已播出部分内容后断流则停止，不重播开头。当前不是全双工，不在小宇讲话时自动收音。详细测量边界见 `docs/voice-latency-check.md`。

第一步不要让模型任意控制页面。先保持 `src/services/tutorEngine.js` 的结构化输入输出边界，再替换模型调用。

Qwen API 当前返回对话回复、白板、离屏任务和单独的结构化成长证据。每次请求同时带入 `activeSpeaker`。后台结果通过字段白名单合并，不能整体替换当前应用状态。关键边界如下：

```json
{
  "messages": [],
  "board": {
    "type": "math",
    "title": "...",
    "items": [],
    "question": "..."
  },
  "growthEvidence": {
    "type": "question",
    "sourceQuote": "必须逐字来自本轮孩子输入",
    "topics": ["月亮"],
    "domains": ["science"],
    "observation": "只描述本轮可观察事实",
    "childIntent": "提问",
    "inference": "可选且克制的推测",
    "confidence": 0.9,
    "shouldSave": true
  }
}
```

当 `activeSpeaker.role !== "child"` 时，系统只把输入保存为家庭观察：

- `sourceType = "parent_note"`
- `reviewEligible = false`
- 不更新孩子兴趣、掌握度、误区和成长结论
- 时间线和导出显示真实说话人

当前身份由家庭手动选择并记住上次结果。自动音色识别需要独立的录入、说话人向量、置信度确认与删除服务，见 `docs/realtime-voice-plan.md`。

这样前端不用重写，只需要让 AI 返回结构化数据。

## Student Memory 数据层

当前本地版本已经按未来数据库的形状拆成：

- profile
- interests
- raw evidence and child quotes
- interests and recurring questions
- growth signals and support observations
- optional skill mastery and misconceptions
- session and offline activity events

真实接 Supabase 时，优先替换 `src/data/localStudentDb.js`，不要把数据库调用散落在 UI 组件里。
