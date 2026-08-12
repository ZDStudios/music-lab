/*
 * A tiny store. The project object is mutated in place (fast for drag-painting);
 * callers take a snapshot before a gesture and then emit what changed.
 *
 *   store.snapshot('draw');      // once, at pointerdown
 *   notes.push(...);             // mutate freely during the drag
 *   store.emit('notes');         // as often as you like
 */

const HISTORY_LIMIT = 120;

export function createStore(project) {
  const subs = new Set();
  const undoStack = [];
  const redoStack = [];
  let pendingLabel = null;

  const state = {
    project,
    /** Non-persisted UI state. */
    ui: {
      tool: 'draw',
      selection: null,      // {r0,r1,s0,s1} inclusive rows/steps
      clipboard: null,
      recording: false,
    },
  };

  function serialize() {
    return JSON.stringify(state.project);
  }

  function snapshot(label = '') {
    // Collapse rapid repeats of the same labelled edit (e.g. dragging a slider).
    if (label && label === pendingLabel && undoStack.length) return;
    pendingLabel = label;
    undoStack.push(serialize());
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  function endGesture() {
    pendingLabel = null;
  }

  function restore(json) {
    state.project = JSON.parse(json);
    emit('project');
  }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(serialize());
    restore(undoStack.pop());
    pendingLabel = null;
    return true;
  }

  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(serialize());
    restore(redoStack.pop());
    pendingLabel = null;
    return true;
  }

  function emit(kind = 'project') {
    for (const fn of subs) fn(kind, state);
  }

  function replace(next, { history = true } = {}) {
    if (history) snapshot('replace');
    state.project = next;
    pendingLabel = null;
    emit('project');
  }

  return {
    state,
    get project() { return state.project; },
    get ui() { return state.ui; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    emit,
    snapshot,
    endGesture,
    undo,
    redo,
    replace,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  };
}
