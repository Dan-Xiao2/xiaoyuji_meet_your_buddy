# MVP 文件架构说明

这个项目先用“本地可运行的小产品骨架”来表达产品逻辑，而不是只做一个静态展示页。

当前组件关系、主链路和数据边界已经同步为可交互架构图：

- `docs/architecture/xiaoyuji-runtime.architecture.html`：可查看、搜索和聚焦链路的展示文件。
- `docs/architecture/xiaoyuji-runtime.architecture.json`：可版本控制、可验证的架构真相源。
- `docs/architecture/README.md`：何时更新、如何校验和生成。

产品边界和优先级以 `docs/product-framework.md` 为准。技术模块不能反过来决定孩子和家长必须看到什么。

2026-10-27 源码复核与后续设计见 [基于现有架构接入 LiveKit](livekit-hybrid-architecture.md)。该文档是未来方案；当前运行架构仍是下述半双工链路，未接入 LiveKit。

2026-10-27 第二轮已完成运行边界调整，见 [整体架构审查与实施记录](architecture-review-2026-10-27.md)：文本API改为有限上下文和受限证据返回；本地业务计算不再直写档案；Qwen取消不再生成fallback。LiveKit仍待接入。

## 核心结构

- `index.html`：页面入口，和共享导航一起呈现一起聊、成长记录、家庭设置、备份记录四个视图。
- `src/bootstrap.js`：先检查档案和备用快照，再加载app；数据无法读取时进入恢复页，不启动正常对话。控件在初始化完成前不可操作。
- `src/app.js`：浏览器组合入口，连接页面事件、语音、绘图和成长记录；stopInteraction 先取消业务再暂停媒体，统一离页/隐藏/结束等入口；语音界面从媒体/任务快照统一派生，不再持有可写voiceUiState。仍有入口局部state引用及绘图异步协调，尚未成为仅装配的入口。
- `src/app/appStore.js`、`src/app/applicationState.js`：store 持有脱离调用方引用的深层只读快照，update 从最新快照计算再提交；applicationState 提供家庭资料、会话开始/结束的纯状态变更。兼容旧 commit 路径，对话/绘图仍保留各自接收校验；保存和渲染仍在订阅端，render 仍读取档案库，尚未成为严格纯视图。
- `src/app/applicationPersistence.js`：普通状态快照、模型/成长片段、会话、观察和珍藏的应用层写入入口，返回成功/失败、失败步骤及已返回的步骤；部分成功保留已保存片段身份。app订阅仍触发快照保存与渲染；档案替换/恢复保持专用流程。多条写入不是事务，不自动重试或回滚。
- `src/app/runtimeDiagnostics.js`：聚合对话、绘图请求/图片、媒体的只读运行快照及最近256条内存事件，记录身份、阶段、拒收与续听原因；不记录正文或媒体、不持久化、不驱动UI。`src/features/drawing/drawingRequestTracker.js`仅观察既有回合取消信号，不新增取消权。A阶段合同、验证及未实施边界见 [运行诊断记录](changes/2026-10-28-runtime-diagnostics.md)。
- `src/features/voice/voiceSession.js`：集中管理当前半双工收音、处理、分段播报、暂停和自动续听；用采集/播放代次及会话身份拒绝旧回调。持有媒体失败/暂停提示，变化时通知页面重新派生展示，不直接指定界面阶段，不访问 DOM 或档案。app 仍负责安全发布和业务提交。
- `src/features/conversation/conversationController.js`：一轮文本对话的开始、取消、快速回复、后台补全和迟到结果丢弃；通过getState读取最新状态，异步结果使用conversationCommit限定字段；accept只消费当前回合实际发出的提交对象一次，进度与replyAccepted仅在内存。候选仅在当前调用内，pending只提交孩子原话和有限域变更，拒收后不调用模型；HTTP经tutorContext投影。
- `src/features/conversation/conversationCommit.js`：pending、quick、complete、protected共用受限合同；纯合并核对会话与消息；单次接收和取消保护由controller.accept负责，不能单独调用apply作为副作用许可。quick要求目标回复尚未存在，接受后在对应原话后插入回复并计数；complete要求已接受回复存在。app的acceptSubmission统一接收与保存/渲染入口；档案多写仍非事务。
- `src/features/conversation/conversationState.js`：对话状态的纯函数，处理待回答、回复插入和受限后台补全；当前取消由运行控制器负责，保留所有正式消息；该模块的旧等待清理仅为历史数据兼容。页面加载时另行识别旧版末尾带身份的待定候选并清理，停止无法恢复的等待。已接受不等于音频已播完；见 [B实施记录](changes/2026-10-28-candidate-isolation.md)。
- `src/services/modelDiagnostics.js`：只允许模型、用量、延迟、fallback和来源字段进入llmStatus；store规范化与对话合并移除pending、enrichmentPending、stage和message。HTTP字段名保留兼容，不把旧响应阶段当任务进度。
- `src/ui/voiceState.js`：deriveVoiceUiState从媒体、对话、route/plan快照派生阶段；后台补全和独立图片不阻塞续听。读取各owner而非诊断日志；不增加展示状态仓库。见 [C实施记录](changes/2026-10-29-runtime-state.md)。
- `src/features/drawing/drawingState.js`：绘图回合字段合并、会话/基图检查及过期结果反馈；本机画面变更序号在每次提交时更新，撤销回旧模型版本也会使原请求过期。它不是持久化版本库或第二份可写画面。
- `src/features/growth/growthTurnContext.js`：从本轮候选与已接受状态捕获有限的视觉/活动上下文；普通聊天不因屏幕保留旧图而继承其领域、标题、主题或快照。quick与补全复用同一份回合内上下文，仍按片段身份和修订保护更新；不新增全局状态或档案格式，不清理历史误关联。
- `src/data/activities.js`：学习活动和示例 prompt。
- `src/data/studentModel.js`：孩子档案、兴趣、成长证据和必要学习信号的初始结构。
- `src/data/familyModel.js`：固定 1 个主孩子档案，另有最多 6 位家长/照护者、当前说话人和手动身份确认状态；不伪装成自动音色识别。
- `src/data/localStudentDb.js`：本地 Student DB 适配层，未来可以替换成 Supabase。
- `src/session/sessionManager.js`：家庭自由开始、结束会话和本次证据摘要；不设置计划结束时间或自动倒计时。
- `src/session/enrichmentState.js`：补全仅合并 memory/studentModel/growthEvidence 和模型状态，不替换 messages/board。前三个字段与请求开始时的序列化快照比较，有并发修改则保留本地字段；不是逐条证据合并，冲突的后台补全会丢弃。
- `src/data/growthInsights.js`：按周/月整理领域、兴趣轨迹和“以前与现在”，输出原始 evidence ID。
- `src/student/`：结构化 Student Model、证据更新、误区判断和互动规划。掌握度只用于确实存在知识任务的场景。
- `src/services/tutorEngine.js`：本地安全/意图/活动候选计算，不直接读写档案；可选onStudentEvent由应用收集、在接受后保存。模型调用位于server/qwenTutor.mjs。
- `src/services/llmClient.js`：前端API连接与本地fallback；通过共享tutorContext限制上行上下文与下行补全字段。
- `src/services/tutorContext.js`：最近12条安全文字、有限资料/记忆投影；排除家长码、家庭表、整份Student Model和图片。服务端再次筛选；后台只返回memory的兴趣/近期观察、growthEvidence和llmStatus。
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
- `src/services/voiceService.js`：录音、ASR、播报、回退与分阶段耗时；启用实时 ASR 时通过 `src/services/realtimeAsr.js` 边采集边上传，单句结束后取得 final；失败回退录音上传。回答时仍停止收音。
- `server/realtimeAsr.mjs`：单句 WebSocket ASR 桥，服务端持有密钥；接收 PCM，客户端 finish 后提交一次 final 并关闭，partial 不进入 Tutor 或成长记录。
- `supabase/`：Supabase-ready 数据库 schema、样例数据、权限策略和查询。

## 已接入的 AI 与语音链路

分积木试点在安全和说话人检查后由本地确定性计划处理，跳过下面两次独立文本生成。讲解和积木动作来自同一组步骤；分段TTS实际开始时触发动作，场景快照进入本地成长片段。其他对话仍走Qwen；不支持的图示保持空白。范围和未完成项见 `docs/whiteboard-interaction-plan.md`。

短回答先调用 `/api/tutor/quick`；短回答确定并交给流式 TTS 后，`conversationController` 再调用 `/api/tutor` 补充结构化证据，不发布白板。补全尝试更新同一个 Growth Moment，不替换已说出口的回答。播报结束约 200ms 后可重新倾听，不等待后台补全。新问题、麦克风切换、数据恢复/清空、结束会话和页面关闭会取消当前轮次；控制器还检查 session ID。片段补全需匹配已保存revision/sessionId；记录缺失、家长已修订或版本变化时不写入。恢复/清空后的旧页面保存会被代次检查拒绝，但同代次跨标签页并发和全部派生数据删除仍未完成。

绘图route/plan等待时不再回写整份旧localTurn；接收时合并允许字段。基图已变化则保留当前图，说明此次没有继续修改，不自动追加付费请求。开放图片仍可跨普通聊天轮次完成，但发布需匹配任务、会话和基图；失败只更新提示、不恢复旧图。绘图路由判为普通聊天时，pending阶段保留当前有效白板，并把路由阶段证据冲突带入后续补全。

TTS 首选 `/api/speech/stream`：Qwen SSE → 服务端 PCM → 浏览器 Web Audio。首段前失败可回退 `/api/speech` 的同音色 MP3；两条云路径都失败时显示原回答和重播入口，不突然切换浏览器系统音色。已播出部分内容后断流则停止，不重播开头。当前不是全双工，不在小宇讲话时自动收音。详细测量边界见 `docs/voice-latency-check.md`。

第一步不要让模型任意控制页面。先保持 `src/services/tutorEngine.js` 的结构化输入输出边界，再替换模型调用。

模型适配器内部仍校验回复、白板、离屏任务与成长证据。HTTP对话边界已收紧：quick返回短答，后台 `/api/tutor` 只返回有限memory、growthEvidence及llmStatus；绘图走独立接口。activeSpeaker只带称呼与角色。证据示例如下：

```json
{
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

## 2026-11-01独立语音实验

`voice-lab.html`与`src/services/livekitVoiceClient.js`负责实验房间、麦克风、播放和控制事件；`server/voiceLab.mjs`负责本机短凭证/派发/清理。`voice-agent/agent.mjs`用AgentSession管理话轮和本地VAD，`companion.mjs`复用业务规则并桥接LLM/TTS，`qwenStt.mjs`桥接持续ASR。默认合成提供器；显式live模式已接通真实Qwen ASR/LLM/TTS，并验证合成输入的本机WebRTC音频、打断与停止。接入曾失败，重试后仍有漏词与高延迟，未达到质量验收；不是模型原生全双工。实验不读写家庭档案，与正式半双工页面分开。详见[实施记录](changes/2026-11-01-livekit-loop.md)和[实验架构](architecture/xiaoyuji-voice-lab.architecture.html)。
