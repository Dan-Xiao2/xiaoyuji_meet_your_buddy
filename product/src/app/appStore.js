export function createAppStore(initialState, { normalize = value => value } = {}) {
  let currentState = normalize(initialState);
  const listeners = new Set();

  return {
    getState() {
      return currentState;
    },

    commit(nextState, event = { type: "state/committed" }) {
      const previousState = currentState;
      currentState = normalize(nextState);
      listeners.forEach(listener => listener(currentState, previousState, event));
      return currentState;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
