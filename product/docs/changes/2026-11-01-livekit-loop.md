# 独立LiveKit语音实验：第一步实施记录

日期：2026-11-01。目标：在现有网页旁建立可运行的语音实验，优先验证媒体闭环与打断，只做必要接入。不把基础重构、SDK安装或合成模型结果当作真实中文儿童体验。

## 已实施

- `/voice-lab.html` 为独立成人实验入口；不导入旧 `voiceSession`，不启动旧网页的自动续听、录音、TTS，不读写家庭档案。现有正式入口与半双工流程保留用于对照。
- `server/voiceLab.mjs` 提供本机会话引导、房间创建、具名Agent派发、五分钟短凭证及清理。入口默认关闭，API仅接受回环地址连接，POST继续使用既有同源/JSON/大小校验。一次只开一个实验会话，停止凭据只对应自己的房间；不是生产账号认证或原生客户端授权方案。
- `voice-agent/agent.mjs` 运行独立Node进程。AgentSession持有话轮；CPU Silero检测用于VAD打断。显式关闭云端自适应打断和预生成；ASR最终转写决定可用文字，本地VAD负责播放中的打断。当前ASR断句650ms、打断最短400ms均为实验初值，未经儿童调参验证。
- `voice-agent/qwenStt.mjs` 是持续WebSocket转写适配器，16kHz PCM实时追加、server_vad断句、多句复用连接，输出SDK事件；不使用旧网页单句WebSocket代理。`companion.mjs` 的LLM适配器复用现有短回答、安全检查和有限上下文；TTS节点把原有SSE PCM转成24kHz SDK音频帧。ASR/LLM/TTS代码边界独立；随后真实接口与本机WebRTC闭环已验证，质量未达标，详见[真实联调记录](2026-11-01-livekit-real-validation.md)。
- LLM仍返回完整短句，不是token流式；TTS仍接收完整文本并输出音频流。实验TTS目前仅走流式接口，不包含旧页面的MP3回退；模型未实际使用时会明确标记本地规则/备用回应。Qwen STT的server_vad和旧链路的手动commit不同，后续比较须单独记录断句差异，不能将体验差异全归因于LiveKit。
- SDK取消会传播到LLM/TTS请求的AbortSignal；停止时先断开本机麦克风/输出，再请求删除房间。页面隐藏/pagehide也停止。连接就绪同时要求麦克风实际打开与Agent双向握手成功，等待Agent超过20秒自动清理并显示失败。
- Agent事件含会话身份和递增序号，前端只接受当前房间Agent的数据；临时列表最多60条，不持久化。生成、SDK估算的播放记录、打断明确区分。
- 没有音频与字词对齐时，打断后的SDK文本是估算；整条被打断的assistant消息不进入下一轮模型上下文，不推断“孩子听完了”。没有实现逐字已播前缀或成长档案提交。
- 语音实验没有白板执行器，明确绘图请求不会宣称已经画好。语音业务仍复用当前规则，而不是另写一套通用陪聊提示词。
- 首轮安全用例暴露“我想自杀”未命中既有规则，增加了明确意图表述匹配；该用例验证不进入文本模型。仍为有限规则，不代表语义安全完整。

## 版本与运行

锁定：`@livekit/agents`及Silero插件1.9.5、`livekit-client`2.23.0、`livekit-server-sdk`2.19.2、esbuild0.28.2。本机验证服务端1.13.11；来自Homebrew发行包，下载后核对SHA-256，二进制仅在工作会话目录，不写入源码库。Node22.22.3。SDK的本地dev命令仍可运行，但有弃用提示，后续升级应复核CLI。

新依赖首次审计报告7项问题，来源为路径匹配与ONNX安装用压缩包间接依赖。已通过受限overrides锁定glob14.0.3、minimatch11.0.3、adm-zip0.6.1；重新安装报告0项漏洞。未运行会大幅降级SDK的自动force修复。SDK实际运行与测试继续验证覆盖后的兼容性。

可复现命令：在product目录安装依赖，确保本机有 `livekit-server`（macOS可用官方Homebrew包）。不在仓库保存二进制或真实密钥。

```bash
npm ci
npm run voice:lab
```

默认启动**合成测试提供器**：STT只对语音活动产生固定测试文本，LLM为固定测试回应，TTS为合成音调。这不是实际中文识别或自然语音。打开启动日志中的本机 `/voice-lab.html`，同意后开始。

若程序不在PATH，可设置 `LIVEKIT_SERVER_BIN`。本轮已校验的二进制位于工作会话 `work/livekit-loop-1/tools/livekit-server`。

```bash
npm run check:voice-lab
npm run check:voice-lab:browser
```

第二条自动启动/结束三个本机进程，macOS缺少样本时使用系统say生成合成语音；其他平台通过 `VOICE_LAB_SPEECH_WAV`提供合成语音WAV。浏览器脚本目前默认Mac Chrome路径，其他环境应设置 `CHROME_PATH`。测试使用虚构资料，不访问家庭档案。不要与完整发布浏览器套件同时运行，以免CPU负载影响Agent派发和实时音频。

真实服务模式必须显式启动：

```bash
npm run voice:lab -- --live
```

该命令使用已有服务端QWEN配置并可能产生费用；已在10元授权内使用系统合成中文验证一次闭环。测试前先核对服务地域、模型可用性和预算；本轮未使用真人录音。实验路由只接受本机连接，不能直接拿这个入口给大陆家庭或iPhone远程试用。

## 验证进展与失败记录

- SDK导入及本机LiveKit/Agent连接已验证。首轮发现SDK凭证要求TrackSource枚举，已修正；测试中验证JWT序列化后的授权仍只允许麦克风与单个房间。
- 钩子单测通过不意味着SDK自动话轮运行；实际运行发现必须提供LLM实例，改为真实LLM适配类。随后的测试修正了脱离活动直接调用默认节点、遗漏连接参数、输出应走SDK队列等问题，均保留失败日志。
- 第一轮真实房间测试已通过语音活动、回应、重叠打断、第二轮回应及停止。随后加强音频能量验证和重复启动检查，发现Agent就绪消息可能早于客户端入房，新增双向握手，不以一次成功掩盖问题。
- 一次同时运行完整回归和音频检查时，SDK记录CPU调度争用并拒绝派发；客户端超时清理。后续实时音频验收串行运行，不放宽打断断言或延长超时来掩盖失败。
- 最终 `npm run check:release` 退出0：400项Node测试（37+142+12+88+5+101+10+5）、13组既有关键浏览器流程全部通过。新增10项检查包括持续ASR协议、多句连接复用、PCM分帧、敏感输入、打断历史筛选、实际SDK请求取消和房间凭证边界。
- 加强后的本机实验检查退出0：确认麦克风就绪、Agent握手、实际非零接收音频、语音重叠打断、第二轮回应、按钮打断后音频归零、停止后轨道结束及迟到事件不更新。新增连接中取消：门控真实已创建房间的凭证响应，取消后释放迟到房间且不重开麦克风。390/1440截图已保存，手机无横向溢出。
- 实时实验与原发布套件分开运行。日志为 `work/livekit-loop-1/logs/release.log`、`browser-release.log`；此前失败日志保留。`git diff --check`通过。
- 两张架构图均9/9检查、0错误0警告，并通过1440/1600/1920/2048独立浏览器检查。实际查看正式图1440浅色、实验图1440浅色及2048深色；未见裁切或遮挡。自动收据仍标记视觉审阅pending，人工查看在此独立记录。

## 尚未完成

1. 真实接口和本机WebRTC闭环已接通，但漏识别开头、6.46秒输入开始至收到回答音频、2.70秒打断至静音暴露质量问题。音色自然度、成人延迟分布和实际账单仍未验收。详见[真实联调记录](2026-11-01-livekit-real-validation.md)。
2. 真实麦克风/扬声器回声、噪声、多说话人、儿童长停顿/附和、误打断与漏打断。当前VAD打断不理解“嗯”“对”等语义。
3. 逐字音频对齐与已播前缀；打断消息目前保守省略，仍有上下文损失。
4. iPhone原生音频层、熄屏/锁屏、来电、蓝牙、网络切换及大陆网络；当前页面隐藏会停止，不能声称支持熄屏。
5. 正式页面集成、家长权限/会话授权、生产部署及费用熔断。五分钟仅是本地实验资源上限，不是产品陪伴倒计时。
6. 成长档案事务、幂等重试与播放证据提交。实验完全不写现有档案，不借此宣称这些问题解决。

下一步先完成成人真实服务对照和iPhone音频可行性验证，再根据结果决定正式页面接入；不继续扩大通用重构。

## 官方核对来源

- LiveKit [AgentSession](https://docs.livekit.io/agents/logic/sessions/)、[节点与钩子](https://docs.livekit.io/agents/logic/nodes/)、[Node参考](https://docs.livekit.io/reference/agents-js/)。网页滚动更新，实际接口以已安装1.9.5声明与运行结果为准。
- 阿里云[Qwen-ASR Realtime客户端事件](https://www.alibabacloud.com/help/en/model-studio/qwen-asr-realtime-client-events)与[实时识别说明](https://help.aliyun.com/en/model-studio/real-time-speech-recognition-user-guide)。

## 真实服务预检阶段的阻断（已解除）

以下是用户配置密钥之前的历史状态。用户确认已配置后，真实接口及本机闭环已执行；当前结果见[真实联调记录](2026-11-01-livekit-real-validation.md)。下面的“0次请求/0支出”只适用于当时预检，不代表本轮累计。

用户已授权本轮真实联调总预算人民币10元。核对当前项目后，没有既有`.env`或已配置的Qwen密钥，ASR未启用。已创建被Git忽略且权限0600的本地`.env`空密钥模板，等待用户在本地填入密钥并确认地域；不要求在聊天发送密钥。

预检已实际执行并以退出码2拒绝发起请求。本轮未发出真实模型请求，API支出为0；不能把适配器模拟通过写成供应商联调成功。

`npm run voice:probe -- --live`已准备：最多十秒系统合成中文语音，一次ASR、一次短回答、一次TTS，不自动重试；ASR失败或LLM回退时不继续下一步。输出仅为合成样本的本地报告与PCM。报告中的10元是授权上限，不是服务商账单查询或账户级强制额度。该脚本本轮仅预检，真实路径尚未执行验证。

## 首次合成闭环交付收据（下列哈希为当时快照）

本批22个源码/测试/配置文件的补丁和哈希位于工作会话 `work/livekit-loop-1/changes.patch` 与 `changed-source-files.json`，不含此前已有改动或任何`.env`内容。`src/app.js`与本轮开始前完全相同。完整回归之后的实验握手/布局/取消补充由最终独立WebRTC检查覆盖；最后的配置状态收紧另经10项定向检查通过，没有伪称为再次运行完整套件。

- xiaoyuji-runtime：specification SHA-256 `1d159a15098a0ba448e24bb365e4954f7be5a13d68efca77c4bd0bcbd186bfd4`；artifact SHA-256 `e5a1f88ab9ec4915ae538e9bd738cef5effb9ec9334f50a557431bb32ac27a5a`；9/9，0错误0警告，browser_evidence passed；visual_review passed。

- xiaoyuji-voice-lab：specification SHA-256 `55b778ab7555aa9d348fcbc1c923b3935bfffefeb3baea725255a315bd1b5302`；artifact SHA-256 `2e7b902692662e6c946e453282facc01cb78958f9504f2bd338659f7cb1a5402`；9/9，0错误0警告，browser_evidence passed；visual_review passed。

实验图校正2轮：第一次用错关系字段名被schema拒绝；随后两处纵向关系标签重叠，按诊断移动标签后通过。正式图只更新说明文字，无布局校正。
