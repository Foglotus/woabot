import { createPluginRuntimeStore } from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk";

export const runtimeStore = createPluginRuntimeStore<PluginRuntime>("WoaBot runtime not initialized");

export function getWoaBotRuntime(): PluginRuntime {
  return runtimeStore.getRuntime();
}
