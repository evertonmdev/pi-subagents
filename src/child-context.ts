import { AsyncLocalStorage } from "node:async_hooks";

export interface ChildSessionInfo {
  isChild: true;
  agentId?: string;
  type?: string;
  /** Explicit .md tool declaration, captured for opt-in extensions at load time. */
  toolDeclaration?: {
    sourcePath: string;
    selectors: readonly string[];
    denied: readonly string[];
  };
}

/**
 * Marks resource loading/session construction and turn execution performed for a subagent.
 * This is async-context-local so concurrent top-level and peer work is unaffected.
 */
const childSessionContext = new AsyncLocalStorage<ChildSessionInfo | boolean>();

export function inChildSessionContext(): boolean {
  const store = childSessionContext.getStore();
  return store === true || (typeof store === "object" && store !== null && store.isChild === true);
}

export function getChildSessionInfo(): ChildSessionInfo | undefined {
  const store = childSessionContext.getStore();
  if (typeof store === "object" && store !== null && store.isChild === true) {
    return store;
  }
  return undefined;
}

export function runInChildSessionContext<T>(fn: () => Promise<T>): Promise<T>;
export function runInChildSessionContext<T>(info: ChildSessionInfo | boolean, fn: () => Promise<T>): Promise<T>;
export function runInChildSessionContext<T>(
  first: ChildSessionInfo | boolean | (() => Promise<T>),
  second?: () => Promise<T>,
): Promise<T> {
  if (typeof first === "function") {
    return childSessionContext.run(true, first);
  }
  return childSessionContext.run(first, second!);
}

if (typeof globalThis !== "undefined") {
  (globalThis as any)[Symbol.for("pi-subagents:child-info")] = getChildSessionInfo;
}
