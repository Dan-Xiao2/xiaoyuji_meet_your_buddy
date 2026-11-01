import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDir, "../references/cognitive-system");
const registryPath = path.resolve(root, "../source-registry.json");
const reviewsPath = path.resolve(root, "../book-reviews.json");
const cardsPath = path.resolve(root, "../knowledge-cards.json");
const catalogPath = path.resolve(root, "../local-parenting-book-catalog.json");

async function readJson(fileName) {
  return JSON.parse(await readFile(path.join(root, fileName), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertUnique(items, field, label) {
  const ids = items.map((item) => item[field]);
  assert(ids.every(Boolean), `${label} contains an empty ${field}`);
  assert(new Set(ids).size === ids.length, `${label} contains duplicate ${field}`);
}

const [manifest, principles, heuristics, tensions, antiPatterns, sourceRegistry, bookReviews, knowledgeCards, bookCatalog] = await Promise.all([
  readJson("manifest.json"),
  readJson("principles.json"),
  readJson("heuristics.json"),
  readJson("tensions.json"),
  readJson("anti-patterns.json"),
  JSON.parse(await readFile(registryPath, "utf8")),
  JSON.parse(await readFile(reviewsPath, "utf8")),
  JSON.parse(await readFile(cardsPath, "utf8")),
  JSON.parse(await readFile(catalogPath, "utf8"))
]);

assert(manifest.schemaVersion === "1.0", "unsupported manifest version");
assert(manifest.runtimeStatus === "review_only", "cognitive system must remain review_only until integration gate");
assert(Array.isArray(manifest.layers) && manifest.layers.length >= 6, "manifest layers are incomplete");

const sourceIds = new Set(sourceRegistry.sources.map((source) => source.id));
const cardIds = new Set(knowledgeCards.cards.map((card) => card.id));
const catalogBookIds = new Set(bookCatalog.books.map((book) => book.id));
const principleIds = new Set(principles.principles.map((item) => item.id));
assertUnique(principles.principles, "id", "principles");
assertUnique(heuristics.heuristics, "id", "heuristics");
assertUnique(tensions.tensions, "id", "tensions");
assertUnique(antiPatterns.antiPatterns, "id", "antiPatterns");

for (const item of principles.principles) {
  assert(item.name && item.statement && Array.isArray(item.ageBands), `${item.id} principle is incomplete`);
  assert(Number.isInteger(item.priority) && item.priority >= 1 && item.priority <= 5, `${item.id} priority invalid`);
  for (const sourceId of item.sourceIds) assert(sourceIds.has(sourceId), `${item.id} references unknown source ${sourceId}`);
}

for (const item of heuristics.heuristics) {
  assert(item.name && item.trigger && Array.isArray(item.decision) && item.outputShape, `${item.id} heuristic is incomplete`);
  for (const sourceId of item.sourceIds) assert(sourceIds.has(sourceId), `${item.id} references unknown source ${sourceId}`);
}

for (const item of tensions.tensions) {
  assert(item.name && Array.isArray(item.poles) && item.poles.length === 2 && item.resolution, `${item.id} tension is incomplete`);
  for (const principleId of item.relatedPrincipleIds) assert(principleIds.has(principleId), `${item.id} references unknown principle ${principleId}`);
  for (const sourceId of item.sourceIds) assert(sourceIds.has(sourceId), `${item.id} references unknown source ${sourceId}`);
}

for (const item of antiPatterns.antiPatterns) {
  assert(item.name && item.trigger && item.response, `${item.id} anti-pattern is incomplete`);
}

assert(bookReviews.schemaVersion === "1.0", "unsupported book review version");
assert(bookReviews.books.length > 0, "book reviews must not be empty");
assertUnique(bookReviews.books, "bookId", "book reviews");
const reviewStatuses = new Set(Object.keys(bookReviews.statusDefinitions));
for (const review of bookReviews.books) {
  assert(catalogBookIds.has(review.bookId), `${review.bookId} is missing from local book catalog`);
  assert(review.title && review.relativePath && Number.isInteger(review.pages), `${review.bookId} review metadata is incomplete`);
  assert(reviewStatuses.has(review.decision), `${review.bookId} has unknown review decision ${review.decision}`);
  assert(Array.isArray(review.absorb) && review.absorb.length > 0, `${review.bookId} has no absorb notes`);
  assert(Array.isArray(review.doNotAbsorb) && review.doNotAbsorb.length > 0, `${review.bookId} has no boundary notes`);
  for (const sourceId of review.crossCheckSourceIds) assert(sourceIds.has(sourceId), `${review.bookId} references unknown cross-check source ${sourceId}`);
  for (const cardId of review.cardIds) assert(cardIds.has(cardId), `${review.bookId} references unknown knowledge card ${cardId}`);
}

for (const card of knowledgeCards.cards) {
  for (const bookId of card.inspiredByBookIds ?? []) assert(catalogBookIds.has(bookId), `${card.id} references unknown local book ${bookId}`);
}

const template = await readFile(path.join(root, "templates/book-review.md"), "utf8");
for (const heading of ["## 书目信息", "## 可验证的核心观点", "## 可以吸收", "## 不应吸收", "## 与现有系统的冲突", "## 案例测试", "## 最终决定"]) {
  assert(template.includes(heading), `book review template missing ${heading}`);
}

console.log(`Cognitive system validation passed: ${principles.principles.length} principles, ${heuristics.heuristics.length} heuristics, ${tensions.tensions.length} tensions, ${antiPatterns.antiPatterns.length} anti-patterns, ${bookReviews.books.length} book reviews.`);
