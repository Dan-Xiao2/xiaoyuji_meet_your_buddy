# 2026-11-14 维护整理与本地改动分组

## 本次范围

整理测试、维护入口、样板索引和可重建产物；不改业务流程，本次复查后按用户要求只提交、推送维护补丁，不清空或夹带其他本地工作。

- `scripts/run-critical-browser-checks.mjs`：新增 `--list`、`--only <name> ...`，逐项执行后汇总失败；任一失败仍返回非零状态。
- `tests/browser-runtime.test.mjs`：验证无需浏览器即可列出流程、错误参数拒绝执行，以及第一项失败后第二项仍执行且总结果失败。
- `tests/drawing-races-browser.mjs`：合成图片预先生成；清理释放延迟请求、等待路由处理结束后关闭上下文，避免回调访问已关闭页面。
- `.gitignore`：精确忽略两个可由 `npm run rtc:build` 重建的 SDK bundle。保留入口源码、锁文件和现有本地 bundle。
- `README.md`、`docs/maintenance.md`、`design-drafts/README.md`：补齐模块导航、测试方法、源文件/产物界线、样板采用状态。
- `docs/development-log.md`：同步当前验收状态。

## 已有问题的核对

先前 390px 空时间段横向溢出：本次开始时工作区已经有 `.growth-date-stepper > span` 的样式修正，避免把日期的最小宽度加到箭头内层图标上。本次保留已有修改；提交时仅纳入这一处日期选择器修复，其他样式改动仍留本地。原 `production-design-browser` 断言没有删减；不把这处样式修复归为本次新增。

绘图清理报错：旧测试先释放延迟图片请求、立刻关闭页面，而回调还要调用 `page.evaluate` 生成图片，存在竞态。本次未修改产品绘图行为。修改前单次完整绘图并发运行也通过，因此不能称为每次必现；修正的是确定存在的关闭顺序风险。

## 工作区审查分组

这是本地工作区快照的审查地图，不是自动暂存列表。目录中存在本次之外的长期修改，且文件还在变化；提交前重新核对 diff，不能直接 `git add .`。

| 分组 | 主要文件 | 依赖和审查重点 |
| --- | --- | --- |
| 家庭图文记录与收藏册 | `src/data/familyEntries.js`、`src/services/familyPhoto.js`、`src/ui/familyJournal.js`、`memoryBook.js`、`parentObservations.js`、`src/styles/memory-book.css`，对应 tests | 同时涉及 `localStudentDb`、`archiveOperations`、`archiveIntegrity`、`storage`、`applicationPersistence`、`archiveControls`、`archiveRecovery`、`memoryPanel`、`summary`；不能仅提交新 UI 文件 |
| RTC 通话与记录 | `src/features/voice/rtcCall.js`、`src/rtc/*-entry.js`、`src/rtc-lab/`、`rtc-lab.html`、`scripts/build-rtc-call.mjs`、RTC tests | 依赖包与锁文件必须一致；SDK bundle 由构建生成；入口回写已移入 `src/app/rtcTurnRecorder.js`，不能漏掉 |
| 会话结果与测量 | `src/session/sessionOutcome.js`、`src/ui/sessionFeedback.js`、`pilotLog.js`、`pilotLogPanel.js` 及对应 tests | 还涉及 `conversationIntent`、`tutorEngine`、语音服务和入口连接；不能把测量成功等同于真实体验达标 |
| 入口职责拆分 | `src/app.js`、`src/app/appView.js`、`conversationFlow.js`、`sessionLifecycle.js`、`onboardingFlow.js`、`parentSettings.js`、`parentAccessController.js`、`growthArchiveController.js`、`rtcTurnRecorder.js`、`applicationState.js`、`src/features/growth/growthMomentInput.js` | 当前拆分建立在上述功能之上。需要一起审查依赖，或者逐段提取并在独立快照验证，不能只提交缩短后的 app.js |
| 设计与形象探索 | `design-drafts/`、`assets/`、`DESIGN.md`、`docs/xiaoyu-character-guide.md`、`ui-design-pipeline.md`、`app-first-entry-idea.md`、`scripts/export-xiaoyu-library.mjs` | 期间观察到旧素材删除及 `assets/xiaoyu/` 新目录，属于其他工作，本次未改、未恢复；提交前另查资源引用与许可 |
| 首次进入与同意 | `src/content/legalDocs.js`、`index.html`、`src/styles/design-system.css`、`tests/production-design-browser.mjs` | 与拆分及设计共用文件，需按段核对；保留同意版本和保存开关行为 |
| 维护整理（本次） | 本文“本次范围”所列文件 | 测试脚本已有 RTC/家庭/测量条目，保留原内容；开发日记也是共享文件 |

共享文件：`index.html`、`src/app.js`、`package.json`、`package-lock.json`、`src/styles/design-system.css`、`server/smoke-test.mjs`、`docs/architecture*` 和开发日记包含跨分组修改。架构 JSON、生成 HTML 和对应验收产物应保持版本一致。根 `AGENTS.md` 与知识来源登记属于另行维护内容，不能漏查或混入“只提交这次”。

推荐审查顺序：底层档案数据/服务 → 家庭记录与 RTC/测量功能 → 入口连接和拆分 → 设计资产/样板 → 共享文档与检查入口。是否分批提交要看实际依赖，不能承诺这些组都能独立运行。

## 拆分遗留检查

检查 `src/app.js`、`src/app/*.js`、`src/features/growth/growthMomentInput.js` 共 15 个文件：相对导入目标存在，没有发现明显未使用的具名导入；首次设置、家长访问、家长设置、收藏、网页对话、RTC 记录、生命周期和视图均在入口初始化一次。未发现需要删除的本次拆分遗留项，因此没有为减少行数继续修改产品代码。这不是全仓库静态类型或死代码分析。

## 验证

- 浏览器运行器 8 项测试通过，含失败继续执行与最终非零状态的隔离集成测试。
- 修改前正式页面 390/768/1440、首次使用、同意更新及关闭保存检查通过；修改前绘图并发 34 个场景通过。
- `npm run check`：570 项 Node 测试、知识/架构检查及 smoke 通过。
- 完整浏览器：20/20 条关键流程通过，包含正式页面、档案、绘图并发、停止与 RTC 模拟；没有跳过原断言。浏览器运行器新增测试在独立运行及 `--list` 入口中均通过。
- 查看了 390px 空时间段截图，无横向溢出；维护链接检查、本次修改的差异格式检查通过。
- 本次独立诊断服务已停止；完整浏览器运行器已结束并清理其测试服务，用户原有服务未动。
- 以上为复查前完整混合工作区的验证结果，不是本次独立提交快照的结果；不代表真实模型/RTC 服务、手机音频或家庭体验通过。

## 复查补丁与发布边界

1. 端口误连已用隔离回归复现：旧运行器把另一个服务的 HTTP 200 当作就绪，开始执行流程。现在只接受自己启动的子进程发出的监听成功消息，提前退出/启动失败直接失败，不向占用端口的其他服务发请求。服务退出有等待和强制停止兜底；流程结束等待输出关闭再汇总。
2. 绘图清理增加 `finally`：即使等待路由清理抛错，也关闭上下文，原错误仍向上传播。
3. 校验测试端口范围。运行器回归覆盖列表、错误选择、非法端口、失败继续、占用端口隔离和启动提前退出。
4. 本次只提交维护文件与日期选择器修复。共享脚本中的家庭图文、会话测量、RTC 三个未提交测试入口留在本地；独立提交沿用远端已有的 17 条浏览器流程。入口拆分、形象素材和其他业务修改不随本次提交。
5. README 指向维护地图；地图和样板索引明确标注本地待提交状态。570 项测试与 20 条浏览器流程是上一轮混合工作区的结果，不拿来代替独立提交验收。

6. 正式页面 `src/app.js` 只暂存两个事件时间戳改动：慢设备的音频初始化在 `pointerdown` 里阻塞主线程，旧算法把阻塞时间算作手指长按，`pointerup` 提前结束收音，浏览器合成语音随后被记成空输入。诊断显示 `media.capture-completed(reason: empty)`，改用原始指针事件时间戳后原始探索流程通过。其他入口拆分改动仍在本地，未暂存。

独立提交快照在修复前：526 项 Node 测试和 smoke 通过，关键浏览器流程 16/17；探索流程单独复测同样失败。修复后原始探索流程的四个场景单独通过。最终 `npm run check:release` 通过：`npm run check` 的 526 项 Node 测试、知识/架构检查与 smoke，浏览器运行器的 11 项测试，以及 17/17 条关键浏览器流程。以上均为本地合成/模拟验收；真实模型、手机音频与家庭体验仍需另行验证。
