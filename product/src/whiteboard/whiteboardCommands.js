import { validVisualScene } from "./visualPlan.js";

export function buildWhiteboardCommands(board) {
  if (!board || board.type === "blank") return [];
  if (board.type === "scene") {
    if (!validVisualScene(board)) return [];
    if (board.scene.kind === "illustration") return [{ type: "draw_illustration", subjects: board.scene.subjects }];
    return [
      { type: "mount_block_scene", sceneId: board.scene.id, total: board.scene.total },
      ...board.scene.steps.map((step, index) => ({
        type: "present_spoken_step", index, given: step.given, text: step.text
      }))
    ];
  }
  if (board.type === "math") {
    return [
      { type: "draw_objects", target: board.items?.[0] || "object", count: board.items?.length || 0 },
      { type: "animate_takeaway", count: board.crossed || 0 },
      { type: "pause_for_answer", text: board.question }
    ];
  }

  if (board.type === "algebra") {
    const commands = [
      { type: "render_equation", left: board.problem?.left, right: board.problem?.right },
      { type: "ask", text: board.question }
    ];
    if (board.visualExplanation) {
      commands.splice(1, 0, {
        type: "draw_group_copies",
        coefficient: board.visualExplanation.coefficient,
        term: `x + ${board.visualExplanation.constant}`
      });
    }
    return commands;
  }

  if (board.type === "story") {
    return [
      { type: "draw_character", value: board.story?.character || board.items?.[0] },
      { type: "draw_place", value: board.story?.setting || board.items?.[1] },
      { type: "draw_story_problem", value: board.story?.object || board.items?.[2] },
      { type: "pause_for_choice", choices: board.story?.choices || [] },
      { type: "send_offscreen_mission", text: board.story?.parentPrompt || "画一画或讲一讲" }
    ];
  }

  if (board.type === "science") {
    if (board.items?.some((item) => /红色|黄色|绿色/.test(item))) {
      return [
        { type: "draw_color_targets", items: board.items || [] },
        { type: "pause_for_observation", text: board.question },
        { type: "send_offscreen_mission", text: "去真实环境里找、摸、比一比" }
      ];
    }

    return [
      { type: "draw_concept_map", items: board.items || [] },
      { type: "pause_for_observation", text: board.question },
      { type: "send_offscreen_mission", text: "去真实环境里找、摸、比一比" }
    ];
  }

  if (board.type === "english") {
    return [
      { type: "draw_word_cards", items: board.items || [] },
      { type: "model_speech", text: "先听，再跟读一个词" },
      { type: "pause_for_answer", text: board.question }
    ];
  }

  if (board.type === "language") {
    return [
      { type: "draw_sentence_frame", parts: board.items || [] },
      { type: "model_speech", text: "把孩子的话扩成一句完整表达" },
      { type: "pause_for_answer", text: board.question }
    ];
  }

  return [
    { type: "draw_prompt_cards", cards: board.items || [] },
    { type: "pause_for_answer", text: board.question || board.note }
  ];
}

export function commandLabel(command) {
  const labels = {
    draw_illustration: "画简笔画",
    mount_block_scene: "摆出积木",
    present_spoken_step: "边说边移动",
    draw_objects: "先画出来",
    animate_takeaway: "演示拿走",
    pause_for_answer: "等孩子说",
    draw_group_copies: "画每一份",
    draw_character: "画主角",
    draw_place: "画地点",
    draw_story_problem: "画问题",
    pause_for_choice: "让孩子选",
    send_offscreen_mission: "去真实世界做",
    draw_color_targets: "画颜色",
    pause_for_observation: "去观察",
    draw_concept_map: "画关系",
    draw_word_cards: "画单词",
    model_speech: "示范说法",
    draw_sentence_frame: "搭句子",
    draw_prompt_cards: "画提示",
    show_objects: "画物品",
    cross_out: "拿走",
    ask: "提问",
    render_equation: "公式",
    show_bracket_copies: "画每一份",
    show_story_cards: "故事卡",
    show_story_choice: "选择",
    assign_offline_task: "去真实世界做",
    show_concept_map: "概念图",
    show_prompt_cards: "提示卡"
  };
  return labels[command.type] || command.type;
}

export function commandAriaLabel(command) {
  const details = {
    draw_objects: `白板会画 ${command.count || 0} 个物品`,
    animate_takeaway: `白板会演示拿走 ${command.count || 0} 个`,
    pause_for_answer: `白板会等待孩子回答：${command.text || ""}`,
    pause_for_choice: `白板会让孩子做选择：${(command.choices || []).join("、")}`,
    send_offscreen_mission: `白板会给出离开屏幕任务：${command.text || ""}`
  };
  return details[command.type] || commandLabel(command);
}
