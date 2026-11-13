# 小宇记语音：现状与路线（2026-11-12）

> 语音功能的总入口：现在用的是什么、哪些是实验、已经做了哪些决定、还要决定什么。关于语音现状，其他文档和本页冲突时，以本页和 `docs/development-log.md` 的状态表为准；产品方向仍以 `docs/product-framework.md` 为最高依据。各文档的用途和状态见文末的“文档地图”。

## 一、三条路线

| 路线 | 状态 | 谁在用 | 主要代码 |
|---|---|---|---|
| **网页语音**（主线） | 孩子页面默认使用。已实现。iPhone 外放做过三轮真机（2026-11-08 到 11-09）：等待中位数约 3.05 秒；开着开口打断时有炸音、音量忽大忽小、打断时灵时不灵（iOS 27 Safari 的问题，网页端修不了）。关掉开口打断（小宇说话时不开麦克风）是否干净，还没测 | 孩子 | `src/features/voice/voiceSession.js`、`src/services/voiceService.js`、`bargeIn.js`、`echoCancellerWorklet.js`、`realtimeAsr.js`、`server/realtimeAsr.mjs`、`server/speechStream.mjs`、`server/qwenSpeech.mjs` |
| **通话模式**（阿里云 AI 实时互动） | 实验。开关在家庭设置 → 设备与测试 → 实验功能，默认关。戴耳机可用，手机外放不可用 | 开发者测试 | `server/rtcCall.mjs`、`server/rtcLlm.mjs`、`src/features/voice/rtcCall.js`、`rtc-lab.html` |
| **LiveKit 实验** | 暂停。只在电脑本机运行，不连家庭档案 | 无 | `voice-lab.html`、`server/voiceLab.mjs`、`voice-agent/` |

## 二、网页语音怎么工作

家长开始聊天后，自动循环：听 → 判断说完 → 回答 → 播放 → 再听。不设倒计时，也不用按住说话。

1. **识别**：经 `/api/asr/realtime`（WebSocket），用 `qwen3-asr-flash-realtime` 边说边传（实验功能里的“实时识别（更快）”可以关掉，默认开）。失败时把整段录音交给 `/api/transcribe`（`qwen3-asr-flash`）。没有云端识别时，才用浏览器自带的识别。
2. **判断说完**：服务端根据识别过程中的文字给出提示。
   - 问句停顿约 0.55 秒就算说完；
   - 一般情况约 0.7 秒；
   - 没说完的半句（……然后 / ……因为）等到约 1.8 秒；
   - 最终文字仍像没说完时，最多再等两次，每次最多 4 秒；
   - 没有实时识别时，统一等 1.05 秒。
3. **回答**：`/api/tutor/quick/stream` 边生成边逐句做安全检查，检查通过的句子马上播放。之后 `/api/tutor` 在后台提取成长证据和兴趣，不改动已经说出口的话。
4. **播放**：`/api/speech/stream` 返回 Qwen 流式 PCM（24 kHz），由页面里唯一的 AudioContext 播放。失败时改用 `/api/speech` 同一音色的整段音频；两条都失败就显示文字和重播按钮，不会换成系统音色。音色由 `.env` 的 `QWEN_TTS_VOICE` 设置，默认 `longanhuan_v3.6`。
5. **开口打断**（家庭设置 → 设备与测试 → 麦克风与语音 →“小宇说话时可以开口打断”，默认开）：
   - 孩子说完后，先打开一个不带系统处理的麦克风。小宇说话时，用页面里的回声消除（AudioWorklet）去掉她自己的声音，再听有没有人说话；
   - 听到声音时，先把小宇的音量压低；识别出第一个字才让她停下；
   - 如果识别出的是小宇自己的话，或者只是“嗯 / 对 / 好”，她就接着说；
   - 戴耳机时改用正常麦克风；
   - 被打断时，记下孩子实际听到的整句，写进下一轮的对话历史。
6. **记录**：每轮孩子的原话和小宇的回答都存在本机。成长片段先保存，后台再补全。
7. **测量**：各阶段耗时记进试点测量（家长 → 设备与测试），只记数字。

这不是全双工：小宇说话时只听孩子有没有打断，不会同时理解孩子在说什么。

## 三、通话模式（实验）

- **做法**：阿里云智能体负责听、判断说完、打断和合成声音；回答由函数计算调用和网页语音同一套快速回答，安全检查也相同。开始通话时带上有上限的摘要。字幕配成一轮一轮的对话存在本机，后台再提取成长证据。接入和排查见 [rtc-verification-setup.md](rtc-verification-setup.md)。
- **真机结论**（2026-11-11 到 11-12）：
  - iPhone（iOS 27）外放时有炸音。这是 iOS 26.2–27 Safari 的已知问题（WebKit 326286），网页端修不了；
  - 安卓外放时音量忽大忽小、说话断续、打断反应慢；
  - 两台手机戴耳机都正常。
  - 调研见 [rtc-phone-speaker-research.md](rtc-phone-speaker-research.md)。
- **决定**：开关保持默认关闭，只在戴耳机时测试。暂不做原生 App（2026-11-12，用户决定）。
- **开放给家庭之前必须做**：
  - 隐私政策写明阿里云智能媒体服务和函数计算，并提高 `CONSENT_VERSION`；
  - 给 `/api/rtc/call` 加限流、单次最长时长和同时通话上限；
  - 确认页面意外关闭后，阿里云智能体实例什么时候结束。
- **可以清理**：测试页的 B–G 对比设置和 2.5.0 旧版组件已经完成任务。

## 四、LiveKit 实验

2026-11-01 在电脑本机跑通了一轮，但漏词和延迟都没达标。[改进计划](improvement-plan-2026-11.md)（11-08）把它列为暂不做。代码保留，不作为迁移方向。[livekit-hybrid-architecture.md](livekit-hybrid-architecture.md) 是 10-27 的设计，只当历史参考。

## 五、已经做出的决定

- 2026-10：云端识别和合成都用阿里云百炼（Qwen），密钥只放在服务器上。
- 2026-11-08：在网页语音上加了回声过滤、附和不打断、按意思判断说完（全双工的第一步）。
- 2026-11-09：网页语音三轮真机后，外放的炸音和音量跳变确认来自 iOS Safari，网页端修不了。用户决定试阿里云通话。
- 2026-11-11：通话模式以开关的形式接入，默认关闭。
- 2026-11-12：手机外放的通话问题网页端修不了。通话模式定为戴耳机时可用，暂不做原生 App。
- 2026-11-13：讨论“两条语音是否都要”后，用户决定先保留通话模式开关（家庭设置 → 设备与测试 → 实验功能，默认关）。给家庭的语音只有网页语音；公网模式（`PUBLIC_MODE`）不开通话模式。以后要升级成“一个模型直接听和说”，考虑用端到端实时语音模型（如 Qwen-Omni-Realtime）替换网页语音背后的引擎，而不是再加一种模式，先看试点数据。

## 六、还没决定的

- 外放时开口打断默认开还是关。现有数据倾向于外放默认关（点小宇打断），戴耳机时再开；先确认关掉后外放是干净的。
- LiveKit 实验是归档，还是留在 `npm run check` 里。
- 通话模式要不要开放给家庭，什么时候开放。

## 七、下一步验证

最先要测：iPhone（iOS 27）外放，**关掉开口打断**，用网页语音聊 10 轮，看有没有炸音、音量跳变。这时小宇说话时麦克风是关着的，按 WebKit 326286 的描述应该不会炸。如果确实干净，就把外放默认改成关掉开口打断（点小宇打断），戴耳机时再开。之后再按 [device-test-matrix-2026-11.md](device-test-matrix-2026-11.md) 补完整的打断测试（外放安静、外放有噪声、AirPods），加一轮安卓外放。

原生 App：2026-11-13 第 0 步已做：用户在同一台 iPhone（iOS 27）上用豆包或 ChatGPT 的 App 开语音通话，外放，边听边插话约一分钟，**没有炸音**。原生这条路走得通，仍暂不做，步骤见 [native-app.md](native-app.md)。

通话模式还有一点没确认：11-11 在 iPhone 上导出的测试数据里只有一条音频路径记录，没有识别、生成、合成的耗时。下次通话后，要看看成长记录里有没有存下对话，导出数据里有没有耗时。

## 文档地图

| 文档 | 用途 | 状态 |
|---|---|---|
| 本页 | 语音现状与决定 | 当前 |
| [development-log.md](development-log.md) 状态表 | 各功能的状态 | 当前 |
| [device-test-matrix-2026-11.md](device-test-matrix-2026-11.md) | 网页语音真机测试清单 | 当前，还没执行 |
| [pilot-lan-setup.md](pilot-lan-setup.md) | 用手机在局域网里测试 | 当前 |
| [rtc-verification-setup.md](rtc-verification-setup.md) | 通话模式接入与排查 | 当前 |
| [rtc-child-dialogue-test.md](rtc-child-dialogue-test.md) | 通话模式的儿童视角对话测试 | 当前 |
| [rtc-phone-speaker-research.md](rtc-phone-speaker-research.md) | 手机外放调研 | 当前 |
| [native-app.md](native-app.md) | 原生 App 的难点和步骤 | 当前，暂不做 |
| [architecture.md](architecture.md)、[architecture/](architecture/README.md) | 运行架构（JSON 是真相源） | 当前 |
| [improvement-plan-2026-11.md](improvement-plan-2026-11.md) | 11 月起 6 周计划 | 当前 |
| [voice-latency-check.md](voice-latency-check.md) | 2026-10 的延迟测量记录 | 历史：判断说完的时长已经变了 |
| [realtime-voice-plan.md](realtime-voice-plan.md) | 2026-09 到 10 月的语音升级计划，含说话人识别设想 | 历史 |
| [livekit-hybrid-architecture.md](livekit-hybrid-architecture.md) | 2026-10-27 的 LiveKit 迁移设计 | 历史，没有采用为主线 |
