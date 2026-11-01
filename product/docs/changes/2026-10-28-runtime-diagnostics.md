# A：运行状态合同与有界诊断

日期：2026-10-28。本次只实施 A，为后续候选、界面、持久化分离建立可观察基线。目标是发生等待、取消或迟到结果时，能辨认当前任务与拒收原因；不改变现有半双工、消息接收和档案格式。

## 已实现的边界

| 所有者 | 只读运行快照 | 身份与实际接收保护 |
|---|---|---|
| conversationController | phase、revision、sessionId、turnId、childMessageId、replyMessageId | 沿用回合代次、AbortSignal、会话和消息内容校验；app 接收提交后确认 accepted |
| drawingRequestTracker | phase、stage(route/plan)、taskId、turnId、sessionId、baseRevision | 观察既有回合信号；实际会话/基图校验仍在 app 与 drawingGuard |
| drawingJob | phase、taskId、turnId、sessionId、baseRevision | 图片有独立 AbortController；核对当前任务及基图后才发布，普通聊天不自动取消合法图片任务 |
| voiceSession | input、output、autoListen、replyMessageId、captureRevision、playbackRevision、sessionId、scheduled | 沿用采集/播放代次和会话校验；回调中的旧身份不被当前身份替换 |
| runtimeDiagnostics | 四类快照的字段投影及最近 256 条事件 | 只收集，不拥有业务、媒体或保存权限；读取返回独立副本 |

快照由各模块内部更新，外部不可直接修改。drawingRequestTracker 新增的只是请求诊断，不是新的绘图取消控制器。app 仍组合模块、校验绘图和执行提交，尚未成为纯装配层。

普通对话阶段为 started → pending → quick → enrichment（如需要）→ result-ready → complete/protected；失败、拒收、取消分别有终态。pending/quick 被接受会产生事件，但不是整轮完成。result-ready 仅代表控制器准备了最终提交，只有 app 实际接受后才确认完成。直接本地保护/绘图回复也在提交后确认；相关图片任务仍可继续运行。

路由/规划的 complete 只代表请求已返回，不代表画面已发布：基图变化可以在请求返回后再触发 drawing.rejected。图片任务的 received 与 accepted 分开，发布回调明确返回 false 会记为拒收。适配器有本地回退路径，因此 received 表示适配器返回，不能据此认定云端请求成功。

媒体 input 为 idle/capturing/processing，output 为 idle/preparing/playing。play-started/play-ended 是适配器控制事件；旧接口 speak 返回 false 时也可能推进结束流程，所以这些事件不能证明设备实际播出了内容，更不能证明孩子听到了哪些字。

## 事件与数据边界

- 对话记录开始、请求、返回、候选完成、接受、拒收、失败、取消；拒收区分旧回合、会话、源消息、回复、状态变化及非法提交等。
- 绘图记录路由/规划/图片的请求与结果，并标识基图变化、旧任务及失败。普通聊天和图片任务保持各自身份。
- 媒体记录采集/处理/结束、播报生命周期、关键旧回调拒收、续听安排及跳过原因。续听原因包括未启用、会话不活跃、页面不可收音、业务等待、输入/输出忙碌。
- 语音输入的 captureRevision 连到 conversation.started；对话的 replyMessageId 连到媒体播报。分段播报带 segmentIndex。文字输入不伪造采集身份。
- 时间是当前页面的单调毫秒时间，sequence 是页面内序号；不是跨设备或跨进程链路追踪。
- 固定保留最近 256 条，超过后丢弃最旧事件并返回 dropped 数量。不记录高频音量、逐帧事件；不保存到 localStorage、IndexedDB 或服务端，刷新即丢失。
- 字段白名单排除正文、转写、提示词、音频、图片、提供商错误原文。保留内部会话/任务/消息 ID 以便关联；这不是完整匿名化，也不是审计存档。任意扩展字段不会自动进入诊断。

本地开发页面可读取快照，不需新增孩子端界面或 window 上的控制器：

```js
const { runtimeDiagnostics } = await import('/src/app/runtimeDiagnostics.js');
runtimeDiagnostics.read();
```

读操作不会取消任务、恢复收音或写入业务。记录覆盖目前接入的应用控制边界，不保证底层已自行过滤的每个回调都有事件，不含服务端排队/提供商内部阶段。日志绕过页面刷新后无法回溯历史故障。

## 测试及证据

1. 改前 check:voice 107/107 通过。
2. 新增 10 项诊断测试，覆盖有界容量、字段过滤/引用隔离、候选与接收区分、旧回合身份、消息修订拒收、错误内容隔离、提交拒收原因、route/plan 取消及图片独立性/发布拒收。
3. 新增 3 项媒体检查，覆盖续听阻塞原因、只读快照、旧回调身份、重复结束；更新原快照结构断言。首次专项 51/52：一项旧断言仍要求四字段，补齐新快照契约后专项全部通过。这不是历史偶发超时的复现。
4. 完整 check:release 退出 0：348 项 Node 测试（25+120+6+88+5+99+5）、知识校验、架构校验、smoke 及 9 组模拟浏览器流程通过，包括第三批 13 个停止场景。
5. 探索浏览器测试在回答、补全、续听、开始和结束等待失败时附带同一份运行快照/事件。第一场景门控快速回答，分别让回答等待与续听等待以 80ms 的测试阈值超时；断言错误包含 quick 请求、回合身份、采集结束且不含测试原话/昵称，释放门控后原连续探索流程继续通过。另断言四个运行所有者已实际注册、四轮 quick 接受和续听事件存在。
6. 最后复核补上 settle 的过期回合保护，防止迟到确认被记成 accepted；增强既有用例后，对话/提交/诊断/待定状态 52/52 通过。再加强故障注入的 sessionId/turnId/captureRevision 对应断言，最终版本连续探索浏览器专项四场景及两次预期超时全部通过。完整发布回归在该诊断保护小修前通过；最终小修验证为上述定向单测和浏览器专项，没有再次执行全套发布回归。

所有浏览器模型、语音与家庭数据均为模拟；未调用真实付费模型。门控的预期超时是测试故障注入，不是发布流程失败，也不能证明历史偶发超时根因已找到。实际故障再次出现时，需结合最后事件与快照进一步定位。

测试日志留在本次工作会话 work/runtime-a/。原有独立档案清空 CI 修复文件未在本轮修改；本轮未提交、推送、部署或运行远端 CI。

## 尚未完成

| 项目 | 本轮后状态 |
|---|---|
| A：运行状态合同和诊断 | 已实现并完成本机受控验证；不是全链路生产可观测系统 |
| B：未发布候选迁出正式历史 | 未实施，仍沿用既有消息结构与第三批停止清理 |
| C：llmStatus 拆分、voiceUiState 从媒体状态派生 | 未实施；新快照当前用于观察，旧字段仍驱动业务等待/UI。不能称为唯一状态源 |
| D：保存协调及跨记录原子性 | 未实施；accepted 是内存业务提交被接受，不是持久化成功或事务提交 |
| E：长历史/大图旧手机性能 | 未测量；没有引入结构共享或改变复制/冻结策略 |
| 历史偶发超时根因 | 未定位；现在增加了下次失败的定位证据 |
| LiveKit、实际已播前缀、iPhone 后台 | 未接入/未验证；当前仍为网页半双工 |

下一批 B 应在保持 A 事件和身份测试的前提下，把候选移入回合运行态，并验证“取消前后正式历史只保留应保留的原话/已接受回复”；不要同时改 UI 派生和持久化，避免无法归因。

## 架构与交付回执

仅更新架构源的语音主链路说明，维持既有节点/布局，不把未来 LiveKit 画成现有能力；同步架构文件说明、维护记录及开发日记状态表。生成结果的9项showcase检查通过，0错误、0警告；最终代码差异检查无空白错误。

- diagram_type: architecture
- output: `/Users/apple/Documents/Codex/2026-08-21/小宇记/product/docs/architecture/xiaoyuji-runtime.architecture.html`
- specification_sha256: `f75685bf04ac96904de065a1fc48402fffa5f1cf3ef4889502cdcf162426f786`（7505 bytes）
- artifact_sha256: `c8482d3f66b2a5bc8f566e8b7165f9233a7688dde1256f494d5274002bb6394f`（722737 bytes）
- validation: 9/9 showcase, 0 errors, 0 warnings
- browser_evidence: passed
- visual_review: passed
- correction_rounds: 0

自动浏览器检查覆盖1440×900、1600×1000、1920×1080、2048×1320，端点尺寸含浅/深色，无横纵溢出。独立读取1440浅色与2048深色截图，未见新增遮挡或布局异常；该图像复核不修改自动侧车的 visualReview: pending，也不代表本轮重新验收了所有交互或导出功能。

团队阅读副本位于本次工作会话 outputs/小宇记_A运行状态与诊断实施记录_2026-10-28.md；图副本为 outputs/小宇记_当前运行架构_A运行诊断_2026-10-28.html。运行源码以 product 仓库为准，旧批次交付文件保留。
