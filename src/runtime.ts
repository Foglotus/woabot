import { createPluginRuntimeStore } from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk";

export const {getRuntime: getWoaBotRuntime, setRuntime: setWoaBotRuntime} = createPluginRuntimeStore<PluginRuntime>("WoaBot runtime not initialized");