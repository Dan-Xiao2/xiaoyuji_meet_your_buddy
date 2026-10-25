import { access } from "node:fs/promises";
import { constants } from "node:fs";

export async function resolveBrowserExecutable({
  chromium,
  override = process.env.CHROME_PATH,
  platform = process.platform,
  canExecute = path => access(path, constants.X_OK).then(() => true, () => false)
}) {
  if (override) {
    if (await canExecute(override)) return override;
    throw new Error("CHROME_PATH 指定的浏览器不可执行；不会静默切换浏览器。");
  }
  const bundled = chromium.executablePath();
  if (await canExecute(bundled)) return bundled;
  if (platform === "darwin") {
    for (const path of [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    ]) {
      if (await canExecute(path)) return path;
    }
  }
  throw new Error("没有可用的 Chromium。请运行 npx playwright install chromium，或设置 CHROME_PATH。");
}
