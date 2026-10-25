# 团队接手指南

## 唯一入口

团队仓库为 https://github.com/Dan-Xiao2/xiaoyuji 。当前产品源代码在 `product/`，根目录历史模板不是当前 App。原先开发目录和 AI_buddy 仓库仍保留，今后团队变更以本仓库 product 为准，避免双向手动同步。

## 第一次运行

1. 使用自己的 GitHub 账号接受邀请，开启双重验证；不要共用账号、密码或 token。
2. 安装 Git 和 Node.js 22，克隆仓库，进入 `product/`。
3. 执行 `npm ci`，再执行 `npm start`，打开 http://localhost:4173。
4. 使用虚构昵称与数据检查页面。不要导入真实家庭档案作为开发夹具。
5. 不配置密钥也可以运行本地规则。它不代表真实 AI 能力。需要模型测试时，复制 `.env.example` 为 `.env`，按账号实际区域和权限配置；先确认费用与调用范围。

`.env.example` 默认关闭文本 LLM、云端朗读与图片生成。ASR 需有效密钥，测试语音也会产生费用。不要把同事或孩子的声音当作无需同意的调试资料。远程手机访问麦克风通常需要 HTTPS 与授权；本机 localhost 成功不代表手机部署验收完成。

## 第一次测试

```bash
npx playwright install chromium
npm run check:release
```

Linux 可能需要 `npx playwright install --with-deps chromium`。以上检查不需要付费密钥，浏览器流程使用虚构数据和模拟接口。真实模型评测为独立、显式付费操作，先审批再运行；不要把 `eval:model` 当普通单元测试。

## 找文件

| 关注点 | 入口 |
|---|---|
| 产品原则和真实进度 | `docs/product-framework.md`、`docs/development-log.md` |
| 页面和样式 | `index.html`、`src/ui/`、`src/styles/`、`DESIGN.md` |
| 对话状态及协调 | `src/app.js`、`src/app/`、`src/features/conversation/` |
| 麦克风和语音 | `src/services/voiceService.js`、`microphoneInput.js`、`server/qwenSpeech.mjs`、`server/realtimeAsr.mjs` |
| 文本模型与知识卡 | `server/qwenTutor.mjs`、`knowledgeCardSelector.mjs`、`skills/xiaoyu-growth-companion/` |
| 精确白板和开放图片 | `src/whiteboard/`、`src/features/drawing/`、`server/openDrawing.mjs` |
| 本地档案和恢复 | `src/data/`、`src/services/indexedArchive.js`、`archiveIntegrity.js` |
| 自动检查和评测 | `tests/`、`scripts/`、`benchmarks/`、仓库根 `.github/workflows/` |

## 每次改动

1. 从最新 main 创建自己的短期分支，例如 `fix/microphone-feedback`。
2. 一次只认领一个有验收标准的任务。周末半天尚未换算成确定容量，不承诺未评估的日期。
3. 提交改动和对应测试；涉及架构或产品边界时按 `AGENTS.md` 同步文档。
4. 推送自己的分支并开 Pull Request，至少由另一人复核。不直接往 main 推未审查功能。
5. PR 写明：改了什么、如何验证、失败/未测项、是否调用付费 API 或影响儿童数据。CI 通过不等于家庭体验验收通过。
6. 团队周会选择一个主 Tracker（飞书或 Excel），不要维护两个可编辑版本。任务 ID 和验收证据写在 PR 中。

## 数据与访问

- 密钥只留本机或受控部署环境；不经聊天截图、仓库、GitHub Issue 或录屏分享。需要撤销权限时同时撤销服务账号访问。
- 原始书籍、家庭录音/照片、导出档案、浏览器个人存储和真实模型日志不进入 Git。
- 当前没有生产级登录、家庭隔离和额度管理。不要把开发服务直接暴露公网，也不要把家长码当服务器身份认证。
- 新同事先获得工作所需最低权限；不要默认给 Admin。管理员需确认仓库可见性、分支保护和退出后的访问撤销。

## 尚需管理员完成

GitHub 邀请、双重验证要求、main 分支保护及 required check（`Product release check / release-check`，以 GitHub 实际显示为准）尚需管理员确认。工作流存在不代表保护已经生效。免费/付费方案与仓库可见性可能影响可用设置。
