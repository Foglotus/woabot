import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setWoaBotRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getWoaBotRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("WoaBot runtime not initialized");
  }
  return runtime;
}
