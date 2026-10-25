# GitHub 参考项目吸收方案

这份文档记录当前 MVP 如何吸收四类参考项目，而不是简单复制它们。

> 这是一份参考实现记录，不决定产品优先级。任何后续增强都必须先符合 `docs/product-framework.md`；其中早期的课堂和刷题方向不再是当前 MVP 主线。

## 1. TaleWeaver：孩子用语音共创故事

吸收点：

- 孩子不需要填复杂表单，直接说“我想听一个……故事”。
- 故事用短段落推进，并在中途让孩子做选择。
- 故事结束后生成复述、画画、改结尾的离屏任务。

当前落地：

- `src/story/storyEngine.js` 负责生成故事结构、选择和结尾。
- `src/services/tutorEngine.js` 的 `handleStoryChoice` 负责处理“我选择红色的门”这类输入。
- `src/ui/whiteboard.js` 把故事角色、地点、发现和选择显示成白板卡片。

后续增强：

- 接真实 LLM，让故事能围绕孩子兴趣和已有成长证据动态变化。
- 增加“孩子复述记录”，把表达能力写回 Student Memory。

## 2. MathVoice：白板命令和误区诊断

吸收点：

- AI 不只是回复文字，而是控制白板画图、划掉、渲染公式、展示错误原因。
- 答错以后判断误区，并生成下一题测试同一个误区。

当前落地：

- `src/student/errorClassifier.js` 负责错误分类。
- `src/student/masteryModel.js` 负责掌握度更新。
- `src/whiteboard/whiteboardCommands.js` 把当前白板状态转成结构化命令。
- `src/ui/whiteboard.js` 显示命令条，方便你看见“AI 正在让白板做什么”。

后续增强：

- 让真实 LLM 输出 JSON 白板命令。
- 增加图形、数轴、方程渲染、比较分类等更多工具。

## 3. OpenAI Realtime：真实语音路线

吸收点：

- 浏览器端只拿临时会话，不暴露真实 API key。
- 语音输入、语音输出、白板工具调用要在同一轮互动里协作。

当前落地：

- `src/services/voiceService.js` 先用浏览器内置语音能力验证 voice-first 体验。
- `docs/realtime-voice-plan.md` 写了下一阶段接 Realtime API 的接口计划。

后续增强：

- 增加 `/api/realtime-session`，由后端创建临时语音会话。
- 让语音 Agent 可以调用 `whiteboard_command`、`save_observation`、`assign_offline_task`。

## 4. Rumi：低门槛家长工作流

吸收点：

- 家长不应该学习复杂后台。
- 产品要把成长证据变成家长几秒钟可以理解的摘要。
- 重点是“孩子主动说了什么、家长怎么继续聊”，不是复杂数据看板。

当前落地：

- `src/ui/parentNote.js` 生成家长摘要和继续沟通提示。
- 家长页可以保存或导出值得记住的内容。
- `src/student/offlineObservationUpdater.js` 把成人线下观察写回 Student Memory。

后续增强：

- 简化家长开始一次陪伴的步骤。
- 把家长确认过的现实活动观察写入孩子的长期记忆。
- 让家长能修正、下载和删除系统保存的成长证据。
