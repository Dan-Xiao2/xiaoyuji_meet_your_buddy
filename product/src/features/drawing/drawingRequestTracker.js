// Route/plan requests use the conversation turn's cancellation signal; images have their own job.
export function createDrawingRequestTracker({ trace = () => {}, onChange = () => {} } = {}) {
  let sequence = 0, active = null, snapshot = { phase: "idle" };
  return {
    begin(turn, base, phase) {
      const token = Object.freeze({ taskId: `drawing-plan-${++sequence}`, turnId: turn.turnId,
        sessionId: base.sessionId, baseRevision: base.revision, stage: phase });
      const cancel = () => {
        trace("drawing.cancelled", { ...token, reason: "stopped" });
        if (active?.token === token) { snapshot = { ...token, phase: "cancelled" }; active = null; onChange(); }
      };
      active?.detach();
      const detach = () => turn.signal.removeEventListener("abort", cancel);
      active = { token, detach };
      snapshot = { ...token, phase: "pending" };
      trace("drawing.requested", token);
      onChange();
      turn.signal.addEventListener("abort", cancel, { once: true });
      if (turn.signal.aborted) cancel();
      return token;
    },
    finish(token, reason = null) {
      const current = active?.token === token;
      trace(reason === "request-failed" ? "drawing.failed" : reason || !current ? "drawing.rejected" : "drawing.received", { ...token, reason: reason || (!current ? "stale-task" : undefined) });
      if (current) {
        active.detach(); active = null;
        snapshot = { ...token, phase: reason === "request-failed" ? "failed" : reason ? "rejected" : "complete" };
        onChange();
      }
    },
    getSnapshot: () => Object.freeze({ ...snapshot })
  };
}
