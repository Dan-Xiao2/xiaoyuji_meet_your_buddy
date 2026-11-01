export function createAppStore(initialState, { normalize = value => value } = {}) {
  // Application state is serializable data. Never share a writable object with a caller.
  const snapshot = value => freezeState(normalize(structuredClone(value)));
  let currentState = snapshot(initialState);
  const listeners = new Set();

  return {
    getState() {
      return currentState;
    },

    commit(nextState, event = { type: "state/committed" }) {
      const previousState = currentState;
      currentState = snapshot(nextState);
      listeners.forEach(listener => listener(currentState, previousState, event));
      return currentState;
    },

    update(transform, event) {
      const nextState = transform(currentState);
      return nextState === currentState ? currentState : this.commit(nextState, event);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

function freezeState(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeState);
    Object.freeze(value);
  }
  return value;
}
