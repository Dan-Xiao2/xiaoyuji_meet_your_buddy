# 手机外放通话的炸音和断续：调研与结论（2026-11-12）

> 适用范围：通话模式（阿里云 AI 实时互动的网页 SDK）。测试页是 `/rtc-lab.html`，逐次测试记录在 `docs/development-log.md` 2026-11-11 到 11-12 的条目里。接入和排查步骤见 [rtc-verification-setup.md](rtc-verification-setup.md)。

## 要回答的问题

1. iPhone 外放通话时为什么有电流声（炸音）？别人遇到过吗，是怎么解决的？
2. 做成 App 能不能避开？
3. 有没有又快又有效的办法？

## 我们的测试结果

| 设备 | 设置 | 结果 |
|---|---|---|
| iPhone（iOS 27.0）外放 | A 现在的设置；B 关闭音量检测；C 先开麦克风；F 旧版组件 2.5.0 | 炸。大音量时一接通就炸，半音量时小宇说话偶尔炸 |
| iPhone 外放 | D 不用手机声音处理；E 组件自己的回声消除 | 不炸，但声音很小、断断续续、听不清用户 |
| iPhone 外放 | G 页面先把小宇的声音调小一半 | 照样炸，声音偏小 |
| iPhone 戴 AirPods | A、D | 全部正常 |
| 安卓 Chrome 外放 | A | 不炸，但音量时大时小、说话不连续、打断反应慢 |
| 安卓戴耳机 | A | 全部正常 |
| 电脑 Chrome | A | 不炸，录下的小宇声音是干净的 |

## 发现

### 1. iPhone 炸音是 iOS 26.2 到 27 的 Safari 已知问题

WebKit 问题库编号 326286，2026-10-04 有人报告，10-08 转进苹果内部跟踪。截至调研时状态还是“新建”，没有负责人，也没有修复时间。报告的内容：

- 开着带回声消除的麦克风时，页面播放的所有声音（通话的远端声音、`<audio>`、Web Audio）都有咔哒声、电流声，声音越大越明显。
- 关掉回声消除就不炸，但声音会改从听筒出来，音量很小。
- iOS 18.7 不炸，Mac 和安卓上复现不出来。
- 报告里给的绕开办法是换成不带回声消除的麦克风，结果声音一样走听筒，并没有真正解决。

另一条相关报告编号 311451（iOS 26 起）：网页一开麦克风，播放就降成低采样率的单声道，关掉回声消除也没用。

这些和我们 A 到 G 的结果一一对得上，说明问题不在小宇记的代码，也不在阿里云。

### 2. 网页端能调的都试过了

- 系统回声消除开或关、组件自己的软件回声消除、旧版组件、音量检测、开麦克风的顺序、页面调小播放音量：没有一种能同时做到“不炸、外放音量正常、能打断”。
- Safari 特有的 `navigator.audioSession` 有个技巧（先设为 auto，开麦克风，再设为 play-and-record），据报告只能解决耳机路由问题，修不了外放炸音（WebKit 282939）。
- 小宇记网页语音的做法是：小宇说话时，用不带系统处理的麦克风，配合页面自己的回声消除，只用来判断孩子有没有打断。这个办法能减轻问题，但 11-08 到 11-09 的真机测试里，外放仍有炸音和音量跳变；只有小宇说话时完全不开麦克风（关掉开口打断）才可能避开，还待验证。阿里云的网页通话组件也没法这样拆开。

### 3. 套壳 App 多半不行，用原生 SDK 才能绕开

- 套壳 App 里的网页（WKWebView）走的是同一套 WebKit 采集，而且外层 App 设置的音频会话，网页不会照着用（WebKit 167788）。
- 原生通话 SDK 都允许开发者自己选音频模式：
  - **通话模式**：用系统的回声消除，调的是通话音量，声音像打电话；
  - **媒体/音乐模式**：用 SDK 自己的回声消除，调的是媒体音量，音质更高。
- 阿里云 ARTC 原生 SDK 的选项：
  - `AliRtcSceneMusicMode`：软件 3A，用手机自带的麦克风采集，官方推荐；
  - `AliRtcSceneDefaultMode`：硬件 3A，支持蓝牙采集；
  - 默认走扬声器；`setAudioProfile` 只能在入会前设置。
- 亚马逊 IVS、腾讯 TRTC 也有同类选项。
- 阿里云 AICallKit 有 iOS 和 Android 原生版（`ARTCAICallKit` + `AliVCSDK_ARTC`），提供音频场景配置 `ARTCAICallAudioScenario`。

### 4. 其他产品怎么做

- ChatGPT 的语音主要在原生 App 里用，底层是 LiveKit 的原生客户端（2026 年 OpenAI 换成了自研方案），不经过 Safari，所以碰不到这个问题。它的 iOS App 也有过语音卡顿的投诉，但原因不同。
- ChatGPT 网页版在 iPhone Safari 上是什么表现，没有找到相关报告。

### 5. 安卓

外放时，浏览器进入通话模式（调的是通话音量，用系统的回声处理），表现为音量时大时小、说话断续、打断反应慢。戴耳机后全部正常。原生 SDK 同样可以通过选模式改善，但还没实测。

## 结论和建议

1. **现在**：孩子页面默认用网页语音，外放时先验证关掉开口打断是否干净，干净就默认关掉（点小宇打断）。通话模式保持默认关闭，只在戴耳机时使用。
2. **零成本验证**：用同一台 iPhone，在 ChatGPT 或豆包的 App 里外放语音聊 1 分钟。不炸就说明原生音频在 iOS 27 上没问题，做原生 App 这条路走得通。
   - 2026-11-13 第 0 步已做：用户在同一台 iPhone（iOS 27）上用豆包或 ChatGPT 的 App 开语音通话，外放，边听边插话约一分钟，**没有炸音**。原生音频在 iOS 27 外放下没问题，做原生 App 能绕开外放炸音（下一步见 [native-app.md](native-app.md)）。
3. **跟进苹果修复**：每次 iOS 更新后，用 `/rtc-lab.html` 按 A 外放试 20 秒。也可以在 WebKit 326286 下补充我们的设备和现象（是否发表由开发者决定）。
4. **彻底解决外放**：做原生 App，界面可以继续用网页。需要 Xcode 和苹果开发者账号，最小原型大约要几天。先看第 2 步的结果再决定。2026-11-13 补充：为了只保留一条语音，原生 App 建议用 iOS 系统的通话级回声消除接现有的识别和朗读，而不是阿里云原生通话 SDK，见 [native-app.md](native-app.md)。
5. 不建议继续在网页端找办法。

## 还没解决的问题

- 阿里云原生 SDK 的音乐场景模式在 iOS 27 外放下实际表现怎样。
- 苹果会在哪个版本修好。AppleVis 上有人说 iOS 27.3 测试版 1 还有音频断续，不确定是不是同一个问题。
- 安卓用原生模式能改善多少。
- ChatGPT 网页版在 iOS Safari 上的表现。

## 来源

- [WebKit 326286：iOS 26.2–27 开着回声消除时播放炸音](https://bugs.webkit.org/show_bug.cgi?id=326286)
- [WebKit 311451：开麦克风后播放音质下降](https://bugs.webkit.org/show_bug.cgi?id=311451)
- [WebKit 230902：iOS 15 WebRTC 声音太小或走听筒](https://bugs.webkit.org/show_bug.cgi?id=230902)
- [WebKit 196539：Safari 无法自动用扬声器外放](https://bugs.webkit.org/show_bug.cgi?id=196539)
- [WebKit 282939：navigator.audioSession 耳机路由的绕开办法](https://bugs.webkit.org/show_bug.cgi?id=282939)
- [WebKit 218012：采集时音量变小的讨论](https://bugs.webkit.org/show_bug.cgi?id=218012)
- [WebKit 167788：WKWebView 不照 App 的 AVAudioSession 设置](https://lists.webkit.org/pipermail/webkit-unassigned/2021-August/992990.html)
- [MDN：Audio Session API](https://developer.mozilla.org/en-US/docs/Web/API/Audio_Session_API)
- [阿里云 ARTC：音频编码和场景模式](https://help.aliyun.com/en/live/set-audio-encoding-and-scene-mode)
- [阿里云 ARTC：音频路由设置](https://help.aliyun.com/zh/live/audio-routing-settings)
- [阿里云 AICallKit iOS 集成概览](https://help.aliyun.com/zh/ims/user-guide/integration-overview-1)
- [阿里云 AICallKit iOS 数据结构](https://help.aliyun.com/en/ims/user-guide/aicallkit-data-structure-ios)
- [亚马逊 IVS：移动端音频模式](https://docs.aws.amazon.com/zh_cn/ivs/latest/RealTimeUserGuide/broadcast-mobile-audio-modes.html)
- [腾讯 TRTC：系统音量类型](https://comm.qq.com/en-trtc/api/trtc.TXSystemVolumeType.html)
- [OpenAI × LiveKit：ChatGPT 高级语音的底层](https://livekit.com/blog/openai-livekit-partnership-advanced-voice-realtime-api)
- [OpenAI 社区：iOS App 语音卡顿](https://community.openai.com/t/audio-issues-on-ios-app-chatgpt/815847)
- [AppleVis：iOS 27.3 测试版音频断续](https://applevis.com/comment/220704)
