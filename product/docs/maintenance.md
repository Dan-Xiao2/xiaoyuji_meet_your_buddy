# 开发与测试导航

更新：2026-11-14。命令在 `/Users/apple/xiaoyuji/product` 执行。产品范围看 `product-framework.md`，当前验证状态看 `development-log.md`。

## 本地工作区入口地图

下表记录本机工作区状态，包含尚未随本次维护提交发布的入口拆分、RTC、图文记录功能。新克隆的仓库不一定有这些文件；没有拆分模块时仍从 `src/app.js` 查找对应职责。这个地图不构成这些功能已在远端交付的声明；分组边界见 `changes/2026-11-14-housekeeping.md`。

## 找到正确入口

| 入口 | 用途与边界 |
| --- | --- |
| `index.html` → `src/bootstrap.js` → `src/app.js` | 正式页面；app 负责连接模块，不集中添加业务实现 |
| `src/app/onboardingFlow.js` | 首次设置、同意更新、麦克风检查 |
| `src/app/parentSettings.js`、`parentAccessController.js` | 家庭资料与开关；家长入口和本地家长码 |
| `src/app/conversationFlow.js`、`sessionLifecycle.js` | 网页对话发布、成长保存、绘图协调；会话起止 |
| `src/app/rtcTurnRecorder.js` | RTC 字幕回合写入与串行补全；按会话/孩子/代次拒收旧结果 |
| `src/app/growthArchiveController.js`、`src/features/growth/growthMomentInput.js` | 收藏册操作；成长片段输入构造 |
| `src/app/appView.js` | 统一页面渲染与语音状态展示 |
| `src/app/applicationState.js`、`applicationPersistence.js` | 状态转换/恢复；持久化入口 |
| `src/ui/familyJournal.js`、`src/data/familyEntries.js` | 家长独立图文记录，不作为孩子原话或自动成长结论 |
| `src/features/voice/voiceSession.js`、`src/services/voiceService.js` | 网页采集与播放流程 |
| `src/features/voice/rtcCall.js`、`src/rtc/` | 正式页面可选的 RTC 通话适配与 SDK 入口；需配置服务并另做真机验证 |
| `rtc-lab.html`、`src/rtc-lab/` | RTC 比较与联调实验 |
| `voice-lab.html`、`src/voice-lab/`、`voice-agent/` | 独立 LiveKit 实验，不等于正式页面已迁移到 LiveKit |
| `mic-check.html` | 本机音频诊断；不是家庭使用入口 |
| `design-drafts/` | 隔离设计样板；状态见其 README，不能把模拟行为直接搬到正式页面 |

实验页的 HTTP 可访问范围由服务端公开路径与运行模式控制。不要为了打开样板扩大正式服务的文件权限；使用已有本机预览方式。

## 验证改动

| 目的 | 命令 |
| --- | --- |
| 语音、档案、成长、服务等普通检查及 smoke | `npm run check` |
| 全部关键浏览器流程 | `npm run check:browser` |
| 查看可选浏览器流程名 | `npm run check:browser -- --list` |
| 仅检查布局和绘图并发 | `npm run check:browser -- --only production-design drawing-races` |
| 交付前完整检查 | `npm run check:release` |

浏览器流程顺序执行，一项失败后继续收集其余结果，最后列出失败文件，并以非零状态退出。浏览器安装或测试服务启动失败则直接停止。启动以本次子进程监听成功的消息为准，不请求可能被其他程序占用的端口；退出时等待该测试服务关闭。单项运行不替代完整发布检查。`BROWSER_TEST_PORT` 可避开端口占用；`CHROME_PATH` 可指定浏览器，指定无效路径不会静默换用其他浏览器。

测试使用独立浏览器上下文、合成资料和模拟接口，不读取家庭浏览器档案。不要拿真实家庭照片替代测试图，也不要运行 `eval:model`、`voice:probe*` 等真实服务探测来替代普通检查；真实探测需单独确认范围和费用。

绘图并发测试故意延迟接口结果以验证取消/旧结果保护。清理时释放等待、等待路由回调结束，再关闭上下文；不要把清理异常一概忽略来获得通过。

## 源文件和生成产物

RTC 构建脚本及其依赖目前属于本地待提交功能；只有检出包含这些文件的版本后才能执行 `npm run rtc:build`。本次仅提前忽略其生成物，不发布 RTC 功能。

| 源文件 | 生成方式 | 管理方式 |
| --- | --- | --- |
| `docs/architecture/*.architecture.json` | 按架构 README 校验并生成 HTML | JSON 与展示 HTML 一起审查；截图/检查报告用于对应版本验收，不手工编辑生成 HTML |
| `src/rtc/aicall-entry.js`、`aicall-v25-entry.js` + 锁文件 | `npm ci` 后 `npm run rtc:build` | 两个 SDK bundle 本地保留但 Git 忽略；新环境/部署使用 RTC 前必须构建 |
| LiveKit 客户端入口 + 锁文件 | `npm run voice:build` | `src/voice-lab/client.bundle.js` 已忽略 |
| 浏览器与评测脚本 | 各检查命令 | `screenshots/`、`reports/` 等已忽略；不把测试截图当设计源稿 |

`.env`、`.certs`、真实家庭导出不提交。整理时不删除测试数据、旧样板、stash、证书或素材。废弃素材需先查运行时和样板引用，再单独确认用途。
