# 小宇记 AI 儿童成长陪伴 MVP

这是一个可以用 VS Code 打开的 AI 儿童成长陪伴产品骨架。它不是单独 HTML 展示页，而是把页面、样式、互动逻辑、成长记忆、安全规则和本地后端分开了。

当前价值主张（2026-10-18）：**小宇是孩子探索日常世界的伙伴：听懂孩子的发现，陪他琢磨问题，把值得留下的瞬间留给家庭。** 先验证 3-6 岁孩子主动分享发现或提出问题，成长留存是随之积累的家庭价值，不是对话任务。单张照片分享与理解仍待实施和验收；本轮只同步产品文档与开发指引，没有改动运行时能力。具体假设、风险和决策门槛见 [当前产品逻辑](docs/product-logic.md)。

## 开发前先读

- 产品身份、核心场景、边界和开发检查表：`docs/product-framework.md`
- 已实现、部分实现、待实现和下一步：`docs/development-log.md`
- 儿童安全规则、固定评测、敏感记录边界与上线门槛：`docs/child-safety-evaluation.md`；离线运行 `npm run check:safety`、`npm run eval:safety`。
- UI 设计规范：`DESIGN.md`；已应用的正式页面 `http://localhost:4173/`。设计参考样板保留在 `http://localhost:4173/design-drafts/design-system/index.html`（仅模拟数据，与正式页面共用视觉变量）。
- 可交互运行架构与持续更新方法：`docs/architecture/README.md`
- 0-6 岁内容来源、年龄卡和成长观察规则：`skills/xiaoyu-growth-companion/SKILL.md`
- 仓库开发约定：`AGENTS.md`

`docs/product-framework.md` 是当前最高优先级的产品依据。孩子端、家长端、成长记忆、内容和技术方案都应与它保持一致。

## 怎么打开

1. 克隆项目仓库后，在 VS Code 打开 `xiaoyuji_meet_your_buddy/product`。需要 Node.js 22（建议 22.13 或更新的 22.x）。当前由用户本人独立开发和维护，操作见 [独立开发指南](docs/team/onboarding.md)。

2. 在 VS Code 终端里运行：

   ```bash
   npm ci
   npm start
   ```

3. 浏览器打开：

   `http://localhost:4173`

请通过服务打开页面，不要直接双击 `index.html`；模块、接口和语音能力需要正确的浏览器运行环境。没有 `.env` 和真实密钥时只提供本地规则与界面验证。

如果页面显示的是旧测试数据，可以点页面里的“清空本地数据”，或在浏览器开发者工具里清掉 localStorage 后刷新。

当前标准流程是：家长首次填写孩子昵称、年龄并同意本机保存 → 家庭之后从首页直接开始自由对话 → 孩子或已登记的家人使用语音，小宇按需使用白板 → 家庭自然结束 → 家长查看三张本次小结卡、周/月回看和成长时间线。第一版每个家庭只有 1 个主孩子成长档案，另外最多登记 6 位家长、祖辈或照护者；多孩子档案以后再增加。当前由家庭手动确认说话人，自动音色识别尚未接通。家长还可以设置可选的 4 位本地家长码。新用户不会预填兴趣、能力、误区或成长结论。

产品整体方向已经扩展为 0-6 岁，但当前可运行界面仍主要验证 3-6 岁孩子直接语音。0-3 岁将采用家长辅助记录和亲子互动模式，不会让婴儿直接使用同一套孩子界面。完整状态和顺序见 `docs/development-log.md`。

## 你最可能会改的地方

- 改首页文案和按钮：`index.html`
- 改整体视觉风格：`src/styles/base.css`
- 改卡片、白板、对话区域样式：`src/styles/components.css`
- 改手机适配：`src/styles/responsive.css`
- 改语音识别/朗读：`src/services/voiceService.js`
- 改 API 地址、模型和开关：项目根目录 `.env`（参考 `.env.example`）；服务端调用分别在 `server/qwenTutor.mjs`、`server/qwenSpeech.mjs`、`server/realtimeAsr.mjs`、`server/openDrawing.mjs`
- 改孩子看到的语音状态：`src/ui/voiceState.js`
- 改不同年龄的回复长度和提问规则：`src/content/ageAdaptation.js`
- 改家长码校验：`src/services/parentAccess.js`
- 改示例问题：`src/data/activities.js`
- 改故事模式：`src/story/storyEngine.js`
- 改家长摘要和继续沟通提示：`src/ui/parentNote.js`
- 改白板命令协议：`src/whiteboard/whiteboardCommands.js`
- 改孩子记忆结构：`src/data/studentModel.js`
- 改结构化学生模型：`src/student/studentSchema.js`
- 改课程规划：`src/student/lessonPlanner.js`
- 改答题判断和记忆更新：`src/student/memoryUpdater.js`
- 看未来 Supabase 表结构：`supabase/schema.sql`
- 改陪伴 Agent 回答逻辑：`src/services/tutorEngine.js`
- 改安全边界：`src/services/safety.js`
- 改白板显示方式：`src/ui/whiteboard.js`
- 改家长成长摘要：`src/ui/summary.js`
- 改会话开始/结束和本次摘要：`src/session/sessionManager.js`
- 改成长回看和兴趣变化算法：`src/data/growthInsights.js`
- 改跨周测试数据：`tests/fixtures/crossWeekGrowthMoments.js`
- 改0-6岁成长陪伴知识：`skills/xiaoyu-growth-companion/references/`
- 登记新的育儿资料：`skills/xiaoyu-growth-companion/references/source-registry.json`
- 更新项目运行架构：`docs/architecture/xiaoyuji-runtime.architecture.json`

## 项目架构图

- 可交互架构图：`docs/architecture/xiaoyuji-runtime.architecture.html`
- 可编辑架构源：`docs/architecture/xiaoyuji-runtime.architecture.json`
- 更新规则：`docs/architecture/README.md`

架构图使用项目级 Archify skill 生成。改变核心组件、API、存储、外部服务或数据边界后，先修改 JSON，再运行：

```bash
npm run check:architecture
npm run architecture:build
```

普通 UI 文案和样式调整不需要更新架构图。

## 现在还不是正式产品的部分

- AI 回复现在可以通过 `.env` 接入 Qwen；如果没有配置或调用失败，会自动回退到本地规则引擎。
- 语音已有麦克风选择、Qwen 实时转写与批量回退、云端 TTS 和浏览器朗读回退；仍需真实设备、幼儿语音准确率和端到端延迟验收，不能因接口接通而认定流畅度达标。
- 成长片段、成长模型和事件保存在浏览器本地：同步缓存写入 `localStorage`，同时建立 IndexedDB 耐久快照；缓存缺失或损坏时可在同一浏览器恢复。它仍不是跨设备备份，清理浏览器数据、换设备或设备损坏会丢失未导出内容。
- Supabase-ready 的表结构已经在 `supabase/` 文件夹里，但还没有连接真实 Supabase project。
- 安全和隐私规则只是产品边界草案，真实上线前需要更严格的合规设计。

## 接入 Qwen 文本 LLM

复制 `.env.example` 为本机 `.env`（不要提交），再填写阿里云百炼的真实配置。配置模板默认关闭文本模型和云端 TTS；测试真实服务时显式开启 `TUTOR_ENABLE_LLM`、`USE_CLOUD_TTS` 并确认账号、区域、模型权限和费用。示例模型名不是账号可用性保证。图片保持关闭，直至单独批准：

```bash
LLM_PROVIDER=qwen
QWEN_API_KEY=你的百炼 API Key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3.7-flash
TUTOR_ENABLE_LLM=true
TUTOR_ENABLE_LOCAL_FALLBACK=true
```

然后重新启动：

```bash
npm start
```

孩子端提问后，页面右上角会显示：

- `Qwen 已参与：qwen3.7-flash`：本轮使用了真实 LLM。
- `Qwen 未成功，本地规则回退`：API 调用失败，但 demo 会继续用本地规则跑下去。
- `本地 API 模式`：服务正常，但还没有发生 LLM 调用。

注意：`OPENAI_API_KEY` 不要填阿里云 key。它只用于未来 OpenAI 语音转写测试；如果不用 OpenAI，保持为空。

普通自动检查运行 `npm run check`。准备交付或合并前运行 `npm run check:release`，它会额外启动隔离服务并执行正式页面、对话、安全和开放画图四条浏览器流程；Playwright 已固定为开发依赖，首次使用仍需安装 Chromium。该检查不会调用真实模型 API。

真实模型比较使用 `npm run eval:model`；包含付费图片创建和编辑时使用 `npm run eval:model:images`。命令只使用固定的虚构场景，结果写入本地忽略目录，且仍需人工复核。完整发布门槛、费用记录方式、真机和家庭试用流程见 `docs/quality-validation.md`。

## 下一步建议

所有任务以 `docs/development-log.md` 中的固定编号跟踪。当前顺序是：

1. `P0-01`：稳定 3-6 岁中文语音主链路。
2. `P0-02`：补齐 Growth Moment 家长确认、修改和删除。
3. `P0-03`：实现家长手动照片附件。
4. `P0-04`：建立 0-6 岁档案和年龄分层基础。
5. `P0-05`：把已建立的来源型成长观察协议接入产品运行时，并通过真实家庭数据校准。

每完成一项都要同步更新开发日记中的复选框、功能状态、完成记录和验证结果。

## Voice-first 使用方式

孩子端现在优先使用大语音按钮：

1. 按住语音按钮，对小宇说话。
2. 孩子说一句话，例如“我想玩苹果拿走小游戏”。
3. 小宇用白板回应，并可以朗读回复。
4. 如果浏览器不支持语音识别，成人可以用文字备用输入。

这个版本的原则是：孩子不用打字，复杂记录留给成人。

当前语音有三层：

- 浏览器支持语音识别时，直接自动听写。
- 浏览器不支持听写但能开麦克风时，会录 4 秒，并尝试走 `/api/transcribe`。
- 如果没有设置 `OPENAI_API_KEY`，云端转文字会显示“待接”，明天演示时可以用“开始演示故事”继续跑完整闭环。

要打开云端语音转文字，可以在启动本地服务前设置：

```bash
OPENAI_API_KEY=你的_key npm start
```

默认转写模型是 `gpt-4o-mini-transcribe`，也可以用 `OPENAI_TRANSCRIBE_MODEL` 指定。

## 故事模式

孩子可以直接说：

```text
我想听小兔子和月亮的童话故事
```

小宇会生成一个原创短故事，用白板展示角色、地点、关键物品和选择。孩子可以点选或说出“红色的门/蓝色的门/绿色的门”，小宇会生成一个短结尾，然后把学习转成“画一画/复述”的线下任务，避免孩子一直停留在屏幕里。

## 这次吸收的 GitHub 参考方向

- TaleWeaver：孩子语音共创故事，不先问很多资料。
- MathVoice：白板命令、误区诊断、下一题规划。
- OpenAI Realtime：后续真实语音架构，API key 只放服务端。
- Rumi：低门槛家长工作流，把成长证据转成简短摘要和继续沟通提示。

对应文档：

- `docs/github-repo-incorporation-plan.md`
- `docs/realtime-voice-plan.md`
- `docs/whiteboard-command-schema.md`
- `docs/archive/early-kindergarten-demo-script.md`：早期园长演示历史稿，不代表当前产品主线
- `docs/preschool-content-strategy.md`

## 家长视角演示建议

演示时可以从一次自然的短互动开始，不需要设置倒计时：孩子说一句想听的故事、一个为什么问题，家长也可以补充一条观察。语音如果在现场浏览器不可用，不要停下来调技术，直接用“成人备用输入”继续。

家长页现在只保留对家长真正有用的内容：

- 孩子档案：昵称、年龄段、最近兴趣和数据保存选择。
- 今天孩子主动说了什么：保留一条原话和相关话题，不把推测写成事实。
- 家长可以怎样接着聊：提供一句短而自然的后续问题。
- 接下来一起做什么：把屏幕里的互动转成现实探索、画画、复述或动手任务。
- 最近的小变化：只展示有证据支持的兴趣、表达和尝试轨迹。
- 数据管理：让家长选择保存、珍藏、下载或删除记录。

这一版不要把后端策略、内容设计依据、园所工作流放到家长页面。那些是内部能力，应该留在代码、文档或未来管理后台里。

## Student Memory / Supabase

这个版本已经加入结构化 Student Memory 的雏形：

- `src/student/`：本地 Student Model、证据更新、可选误区判断和互动规划
- `src/offline/`：现实探索任务库
- `src/story/storyEngine.js`：原创短故事生成和故事结构
- `src/data/localStudentDb.js`：本地 Student DB 适配层
- `supabase/`：未来可以直接迁移到 Supabase/Postgres 的数据库设计
- `docs/student-memory-architecture.md`：为什么这样设计记忆
- `docs/supabase-setup.md`：之后怎么接 Supabase
