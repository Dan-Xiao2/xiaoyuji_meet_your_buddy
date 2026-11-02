# 对话接话优化：第一批核查与评测入口

日期：2026-11-02。范围：规则核查、原创上下文案例、正式服务端流式生成函数的评测采集。未改变运行时回应规则或模型，未调用真实服务。本批不代表回答质量改善。

## 已核查的路径与规则

`server/qwenTutor.mjs` 的 resolveQuickGate 先经过安全、本地控制话语、视觉规划及模型启用检查；本地返回可能完全不经过提示词。quick 和 stream 共用 buildQuickReplyBody：口语风格、纠正/跟随、留话头、可关闭的 turnGuidance、知识上下文，最后附共享 responseBoundaryInstruction。完整 Tutor 使用共享边界，但不使用同一份 quick 提示。模型读取最近12条安全历史；本轮分类 classifyChildTurn 只读取当前输入。turnGuidance 读取上一条 tutor 的问号来限制连续提问。

正式 HTTP 路由 `server/server.mjs` 的 `/api/tutor/quick/stream` 调用 streamQuickTutorReplyWithQwen；每个放行段以 NDJSON 发送，浏览器随后负责播放。首段可以在逗号处分出，不保证是完整句子。流式后段失败不能撤回先前段落，这也是必须保留分段证据的原因。

### 代码与离线调用已确认的缺口

| 位置 | 触发例子与当前结果 | 影响与下一步 |
|---|---|---|
| turnGuidance classifyChildTurn / ACK | “你把豆子种进土里了吗？”→“嗯”与听解释后的“嗯”均为ack；指引称其没有新内容，并要求新细节 | 肯定回答与附和没有区分；比较模型是否遗漏确认、误推新内容 |
| turnGuidance DONT_KNOW | 回答事实问题与感受问题的“不知道”都要求提示或有趣答案 | 感受不明可能被当成知识答不出；比较是否强加感受或跳话题 |
| turnGuidance DONE | “今天那个水坑还在吗？”→“没有了”仍为done，要求按分享结束回应 | 物体消失与说完混淆；后续应结合上下文处理歧义 |
| turnGuidance 默认share | “不知道，我现在不想说。”判为share，指引要求补新细节；共享边界又要求拒绝后停止 | 同一请求内有方向张力；优先修正明确拒绝的冲突，不扩大为任意否定词拦截 |
| GUIDANCE.feeling / noQuestion | “和他一起玩是什么感觉？”→“开心”仍要求再问，且feeling明确豁免上轮已提问限制 | 与共享“不连续两轮问题结尾”的要求冲突；应比较是否形成连问 |
| conversationHookInstruction / followChildInstruction | 前者对“嗯/不知道”作绝对解释；后者纠正后建议问一句或听实际看到什么 | 上下文细分不足；不能用一条机械停止规则替换所有话头 |

以上是分类和生成指令的可复现结果，不是模型实际犯错次数。模型仍能读取历史并可能自行化解冲突，因此真实效果保持待验证。`tests/turn-guidance.test.mjs` 甚至明确测试 feeling 豁免，后续改规则时必须同步调整该行为测试。

## 已完成的评测产物

- 原有 `conversation-quality.json` 的16组情境保持不变。
- 新增 `benchmarks/fixtures/conversation-context.json`：11组14轮，含同词异义、拒绝、纠正、绘画情绪和拒绝后换题；每组有人工评审标准。
- seedMessages 是原创固定前情，专门隔离上下文差异，不能称作实际前轮输出。组内后续轮使用实际生成回答。
- `scripts/benchmark-conversation-turn.mjs` 采集生产生成函数的文本放行段、相对毫秒和最终诊断；异常/截断保留，不伪装完整成功。
- 现有 `scripts/benchmark-real-model.mjs` 增加 `--reply-mode=quick|stream`（默认quick）、`--suite=conversation|context`（默认conversation）。报告新增配置、Git版本/工作区是否有改动、上下文、放行段、首段时间及guard/截断结果。
- 报告schemaVersion升为2；原有生成字段保留。截断或诊断失败会令命令非零退出，报告仍保存以供检查。
- 新增 `npm run check:dialogue`，纳入总检查。网络全部模拟；覆盖实际流式生成函数、逗号首段、usage、部分失败、本地免调用、取消、案例结构、付费开关和CLI报告/跨轮历史。

上下文专项暂时只有人工语义标准，机器topicPassed没有语义判分能力。尤其不能把这批报告中“关键词通过率100%”解释成对话达标。参考答案不是唯一措辞；本批没有用固定答案替代模型回答。

## 下一批真实采集操作

当前未查到实际账单、此前10元累计授权余额未知。本批不消费该额度。以下命令仅作为后续执行说明；必须先核清可用额度。--max-text-calls限制请求次数，不限制人民币支出；缺少价格或usage时成本保留null，不能报零费用。

先小批确认报告（在product目录，使用本地服务端环境，密钥不进入报告）：

```sh
node scripts/benchmark-real-model.mjs --live --allow-paid-api --reply-mode=stream --suite=context --scenarios=ack-answer,gone-object --max-text-calls=4
```

再分别采集上下文全组、原有16组；比较时固定模型和参数、同一组输入及重复次数，保留每一轮的实际历史。干净提交上采集，避免同一个Git版本掩盖本地提示词差异。报告默认位于被忽略的 `reports/real-model/<时间>/report.json`，不提交家庭数据或凭据。

基线采集后才按失败原因作最小修正：先明确拒绝与物体消失，再处理感受连问、短答/附和。每次只修有证据的一类。另写未用于调试的变体留作后续验证；本批11组都是开发题，尚无独立留出集。

人工比较隐藏版本标签，逐轮检查：理解意思、跟随上下文、回应分量、自然具体；允许持平、退步、两版都差。单人自评不能称独立复核。必须保留有帮助的话头，防止优化后只剩冷淡确认。

## 验证与未完成

- 新增7项离线测试在CI禁用真实模型的环境下通过，所有请求为模拟，未使用真实密钥进行调用。
- 首次测试发现清理报告路径对中文目录的URL编码处理不当，已改用dirname；修正后7/7通过。
- 同CI禁用真实服务配置下，完整 `npm run check:release` 退出0：486项Node检查、smoke及17组关键浏览器流程通过。首次运行因本机端口权限导致7项识别测试EPERM，允许本机端口后重跑通过；未改测试断言或产品代码规避失败。远端Linux检查另行确认。
- 未采集真实模型基线、未改回应逻辑、未做A/B、未测试TTS听感/儿童/iPhone；未完成HTTP端到端采集。当前入口只直接验证正式服务端生成函数。
- 未改变核心组件、API、存储或外部服务关系，因此不更新运行架构图。
