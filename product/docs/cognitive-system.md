# 小宇记统一判断系统

## 目标

小宇记不把 318 本育儿书做成 318 个独立 Skill。书籍、指南、研究和家长观察只是输入；产品真正要沉淀的是一套内部统一、可以反复调用、能够解释来源和承认不确定性的育儿判断系统。

它要回答的不是“某本书怎么说”，而是：

> 在这个年龄、这个家庭场景和这份证据下，小宇记为什么选择这个回应，哪些事情不能做？

## 本轮吸收的开源思路

| 来源项目 | 吸收什么 | 不直接照搬什么 |
|---|---|---|
| [nuwa-skill](https://github.com/alchaincyf/nuwa-skill) | 心智模型、决策启发式、反模式、诚实边界；保留矛盾并用新案例检验 | 它面向单个人物；小宇记不模拟某位作者，也不把模型生成的“名人观点”当一手事实 |
| [skill-from-masters](https://github.com/GBSOSS/skill-from-masters) | 本地资料 → 补充检索 → 一手来源、黄金案例、反模式、交叉验证 | 不自动把网页搜索结果直接变成产品规则；每条原则仍需人工和专业复核 |
| [anyone-skill](https://github.com/acnlabs/anyone-skill) | 证据分级、伦理/版权检查、修正、演化和回滚的思路 | 不使用人物数字分身结构；儿童内容采用来源登记和家长可修正机制 |
| [ACE Framework](https://github.com/daveshap/ACE_Framework) | 把价值/使命放在策略和执行之前，明确层级责任 | 不引入庞大多层自治系统；当前只保留对内容安全有实际帮助的层级 |
| [Fabric](https://github.com/danielmiessler/Fabric) | 可复用的提炼、主张分析、自我审查和修订模式 | 不堆叠大量互相独立的 Prompt Pattern；所有内容进入同一个判断系统 |
| [Graphiti](https://github.com/getzep/graphiti) 与 [Letta](https://github.com/letta-ai/letta) | 时间变化、来源追溯、可编辑记忆、版本与回滚的设计方向 | 当前不增加外部数据库依赖；先用仓库内 JSON、Markdown 和现有本地成长记录验证价值 |

这些项目提供的是方法和架构启发，不是本项目复制的代码。当前实现只在“小宇记”仓库内使用自己的数据结构。

## 系统分层

```text
原始资料与家长观察
        ↓
观点/证据卡：谁说的、依据是什么、适用几岁、能否授权
        ↓
核心原则：小宇记稳定相信什么
        ↓
判断启发式：遇到什么情况怎样回应
        ↓
冲突处理：自主/安全、温暖/准确、个性化/隐私
        ↓
反模式：明确不能推断或不能做的事
        ↓
案例评测：已知、新问题、来源冲突、边界问题
        ↓
通过后才进入 Tutor、家长建议和成长观察
```

## 当前文件

- `skills/xiaoyu-growth-companion/references/cognitive-system/constitution.md`：宪法与判断优先级。
- `skills/xiaoyu-growth-companion/references/cognitive-system/principles.json`：8 条当前产品原则。
- `skills/xiaoyu-growth-companion/references/cognitive-system/heuristics.json`：6 条可执行判断启发式。
- `skills/xiaoyu-growth-companion/references/cognitive-system/tensions.json`：5 组必须保留的价值张力。
- `skills/xiaoyu-growth-companion/references/cognitive-system/anti-patterns.json`：8 条禁止模式。
- `skills/xiaoyu-growth-companion/references/cognitive-system/book-absorption.md`：新书吸收流程。
- `skills/xiaoyu-growth-companion/references/cognitive-system/templates/book-review.md`：一页式书籍评审卡。

## 一本书什么时候能被吸收

一本书不会因为“有用”或“很多书都提到”就进入运行时。至少要完成：来源与版权登记、原子观点提取、官方/专业来源交叉核对、冲突审查、三个案例测试，以及明确的接受/暂缓/拒绝决定。

医学、营养、睡眠、疾病、筛查和发育里程碑相关材料必须提高门槛；商业电子书默认只作内部研究和原创摘要，未经授权不能把全文或扫描内容放进 Skill、向量库、提示词或训练集。

## 当前接入边界

本系统目前处于 `review_only`：它已经可以支撑资料评审，但尚未自动改变孩子端回答。接入运行时前必须满足：

1. 通过机器结构校验和来源引用校验。
2. 对已知案例保持一致，对新案例表达不确定性。
3. 在来源冲突时展示限制而非伪造共识。
4. 家长可以查看、修正、排除和删除相关成长记录。
5. 儿童安全、隐私和医学边界测试通过。
