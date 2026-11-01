export async function readRuntimeDiagnostics(page) {
  return page.evaluate(async () => (await import("/src/app/runtimeDiagnostics.js")).runtimeDiagnostics.read());
}

export async function waitWithRuntimeDiagnostics(page, boundary, wait) {
  try { return await wait(); }
  catch (cause) {
    const diagnostics = await readRuntimeDiagnostics(page).catch(() => ({ unavailable: true }));
    const failure = new Error(`Runtime wait failed at ${boundary}: ${JSON.stringify(diagnostics)}`, { cause });
    failure.runtimeDiagnostics = diagnostics;
    throw failure;
  }
}

// Playwright polling evaluates truthiness synchronously; a Promise is not a condition.
export async function installRuntimeReader(page) {
  await page.evaluate(async () => {
    window.readTestRuntime = (await import("/src/app/runtimeDiagnostics.js")).runtimeDiagnostics.read;
  });
}

export async function waitForConversationPhase(page, phase) {
  await installRuntimeReader(page);
  return waitWithRuntimeDiagnostics(page, phase, () => page.waitForFunction(
    phase => window.readTestRuntime().snapshots.conversation.phase === phase, phase));
}
