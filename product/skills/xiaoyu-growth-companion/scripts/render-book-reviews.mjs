import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const referencesDir = path.resolve(here, "../references");
const reviews = JSON.parse(await readFile(path.join(referencesDir, "book-reviews.json"), "utf8"));
const statusLabels = reviews.statusDefinitions;

const lines = [
  "# 20本育儿电子书逐本评审",
  "",
  `> 第一轮初审：${reviews.reviewedAt}。本文件是内部研究记录，不是书籍全文摘要，也不是医学或教育评定。`,
  "> 本轮根据文件元数据、主题相关性和已登记权威来源做保守评审；页码级正文复核、版本核验和版权核验仍需继续。",
  "",
  "## 先看结论",
  "",
  `- ${reviews.books.filter((b) => b.decision === "runtime_via_cross_check").length} 本：可作为内部线索，并通过交叉核对后的原创知识卡进入运行时。`,
  `- ${reviews.books.filter((b) => b.decision === "internal_only").length} 本：保留为内部判断材料，不直接驱动 Tutor。`,
  `- ${reviews.books.filter((b) => b.decision === "needs_professional_review").length} 本：健康、睡眠、身体教育或专业边界，待专业复核。`,
  `- ${reviews.books.filter((b) => b.decision === "version_merge").length} 本：与其他版本合并，不重复吸收。`,
  "",
  "## 评审方法",
  "",
  ...reviews.method.map((item) => `- ${item}`),
  "",
  "## 逐本评审",
  ""
];

for (const [index, book] of reviews.books.entries()) {
  lines.push(`### ${index + 1}. ${book.title}`);
  lines.push("");
  lines.push(`- **本地文件**：\`${book.relativePath}\``);
  lines.push(`- **作者/版本线索**：${book.author}；${book.pages} 页`);
  lines.push(`- **决定**：${statusLabels[book.decision]}`);
  lines.push(`- **评审置信度**：${book.confidence}`);
  lines.push(`- **可吸收**：${book.absorb.join("；")}`);
  lines.push(`- **明确不吸收**：${book.doNotAbsorb.join("；")}`);
  lines.push(`- **交叉核对来源**：${book.crossCheckSourceIds.join("、")}`);
  lines.push(`- **知识卡**：${book.cardIds.length ? book.cardIds.map((id) => `\`${id}\``).join("、") : "本轮不生成"}`);
  lines.push(`- **备注**：${book.notes}`);
  lines.push("");
}

lines.push("## 运行时边界");
lines.push("");
lines.push("知识卡中的 `sourceIds` 指已登记、用于支持产品行为的权威或开放来源；本地商业书籍只在 `book-reviews.json` 和知识卡的 `inspiredByBookIds` 中作为内部溯源线索。未核实授权前，不把本地电子书全文、扫描页、表格、案例或练习放入仓库、向量库、提示词或训练集。");

await writeFile(path.join(referencesDir, "book-reviews.md"), `${lines.join("\n")}\n`, "utf8");
console.log(`Rendered ${reviews.books.length} book reviews.`);
