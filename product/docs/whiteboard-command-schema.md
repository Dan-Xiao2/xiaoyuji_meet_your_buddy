# 白板命令协议

白板不要只当成一个展示区域。长期来看，它应该是 Companion Agent 可以按需调用的纸和笔。

当前实现位置：

- 命令生成：`src/whiteboard/whiteboardCommands.js`
- 命令展示：`src/ui/whiteboard.js`
- 互动规划/误区来源：`src/services/tutorEngine.js`

## 设计原则

- AI 先判断本轮是否需要视觉辅助，再输出结构化命令。
- 前端只负责把命令画出来，不负责猜互动意图。
- 命令要足够简单，幼儿园版本以物品、故事卡、选择、离屏任务为主。

## 当前命令类型

### 素材目录与对象保护（2026-09-09）

v2 可画对象由 `drawingCatalog.js` 登记，新增 `rabbit` 与 `car`，沿用稳定ID、颜色、缩放、移动、复制、删除和撤销。地面仍最多3个对象。小兔白色身体、汽车红色车身为缺省值；`color` 分别仅改变身体/车身。颜色表新增白色，所有支持颜色的字段共用六色表。模型不能传自定义素材、SVG或路径。

规划器上下文附带 `availableObjects` 和 `protectedIds`；执行前后及逐句画面均检查显式保护对象没有变化。“汽车变蓝，兔子不要变”可本地完成，复杂组合仍使用 Qwen。保护语法与限制见 `whiteboard-open-source-adoption.md`；车窗、车轮、兔耳等尚不能独立编辑。

### 连续绘画与房子部件（2026-09-08）

`scene.kind = "illustration"`、`version = 2` 的对象协议在 `src/whiteboard/drawingScene.js` 校验；Qwen 与本地入口共享原子 `update`，不接收模型生成的 SVG/代码。

房子对象新增可选字段，旧快照无需重写：

| 字段 | 允许值 | 缺省显示 |
|---|---|---|
| `doorShape` | `arched` / `rect` | 拱形门 |
| `doorColor` | 共用六色之一 | 绿色 |
| `windowCount` | 整数 0–4 | 2扇 |
| `windowShape` | `square` / `round` | 方窗 |
| `windowColor` | 共用六色或原浅蓝 `#d7eaf0` | 浅蓝 |

窗形与窗色作用于同一房子的所有窗户，不是单窗ID。加减数量从当前值计算，超界拒绝而不截断；非房子对象不允许上述字段。字段同时受当前对象、历史与播放帧校验。复制保留部件，撤销仍以整个请求为一步，JSON及成长快照保留字段。

渲染沿用现有 SVG/Rough.js，每个部件有稳定键；只替换几何发生变化的部件，颜色直接更新，墙与屋顶不重画。不增加孩子端工具栏、模型服务或儿童数据采集。

简单中文指令本地执行；复杂组合使用现有受约束规划器。单步立即显示，多步仍按语音开始事件切帧。单独某扇窗、门窗缩放、开关门、烟囱和任意插画尚未支持。

2026-09-07 增加 `board.type = "blank"` 与有边界的 `board.type = "scene"`。空白不生成提示卡。

积木场景使用 `scene = {kind: "blocks", id, revision, total, given, fromGiven, recipient, steps}`；数量0–10且total至少1，given不能超过total，每一步含 `{given, text}`。同一场景追问保留id、递增revision。运行时由 `visualPlan.js` 产生，不接受模型编写绘图代码。

`buildWhiteboardCommands` 对该场景输出 `mount_block_scene` 和 `present_spoken_step` 描述；真正执行者是 `whiteboard.js` / `blockScene.js`，语音onStart驱动步骤。下面旧命令仍是描述层，不是任意指令都已经实现的通用画布引擎。详细范围见 `whiteboard-interaction-plan.md`。

```json
{
  "type": "draw_objects",
  "target": "apple",
  "count": 5
}
```

```json
{
  "type": "animate_takeaway",
  "count": 2
}
```

```json
{
  "type": "pause_for_answer",
  "text": "还剩几个？"
}
```

```json
{
  "type": "draw_character",
  "value": "小兔子"
}
```

```json
{
  "type": "draw_place",
  "value": "月光小路"
}
```

```json
{
  "type": "pause_for_choice",
  "choices": ["红色的门", "蓝色的门", "绿色的门"]
}
```

```json
{
  "type": "send_offscreen_mission",
  "text": "画一画或讲一讲"
}
```

```json
{
  "type": "draw_color_targets",
  "items": ["红色", "黄色", "绿色"]
}
```

```json
{
  "type": "draw_sentence_frame",
  "parts": ["谁", "在哪里", "做什么"]
}
```

```json
{
  "type": "model_speech",
  "text": "先听，再跟读一个词"
}
```

## MVP 阶段的 AI 输出格式

后面接入真实模型时，不建议让 AI 直接生成 HTML/SVG。更稳的方式是让 AI 输出一个白板动作数组，前端只解释这些受控命令：

```json
{
  "reply": "我们先不急着算。你看，白板上有 5 个苹果，我拿走 2 个。",
  "whiteboard": {
    "title": "5 个苹果，拿走 2 个",
    "mode": "数感 + 动作",
    "commands": [
      { "type": "draw_objects", "target": "apple", "count": 5 },
      { "type": "animate_takeaway", "count": 2 },
      { "type": "pause_for_answer", "text": "还剩几个？" }
    ]
  },
  "student_memory_update": {
    "skill": "subtraction_within_10",
    "evidence": "孩子需要看见拿走动作",
    "next_probe": "用真实积木再做一次"
  }
}
```

这样做的好处：

- 内容安全：AI 不直接写网页代码。
- 视觉稳定：同一个命令在手机、电脑、白板上都能画。
- 可积累：命令和 Student Memory 可以对应起来，知道孩子为什么需要这个画法。
- 可替换模型：DeepSeek、通义千问、豆包等模型都只需要学会输出同一套 JSON。

## 以后可以增加的命令

- `show_number_line`
- `group_objects`
- `compare_objects`
- `render_equation`
- `render_graph`
- `highlight_misconception`
- `show_timer`
- `show_parent_prompt`

## 和 Student Memory 的关系

白板命令不是孤立动画。它应该由 Student Model 决定：

```text
Student Model
  ↓
Interaction Planner
  ↓
Companion Agent
  ↓
Whiteboard Commands
  ↓
Student Response
  ↓
Error Classification / Observation
  ↓
Student Model Update
```

例如，孩子连续两次不理解“拿走”：

```json
[
  { "type": "draw_objects", "target": "apple", "count": 5 },
  { "type": "animate_takeaway", "count": 2 },
  { "type": "pause_for_answer", "text": "你能用手拿走 2 个吗？" },
  { "type": "send_offscreen_mission", "text": "用 5 个真实积木再玩一次" }
]
```
