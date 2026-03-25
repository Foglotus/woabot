import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { woabotPlugin } from "./src/channel.js";
import { runtimeStore } from "./src/runtime.js";

const plugin = {
  id: "woabot",
  name: "WOA Bot",
  description: "WOA Bot channel plugin — 通过 Server 中转连接 WPS 办公助手",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    runtimeStore.setRuntime(api.runtime);
    api.registerChannel({ plugin: woabotPlugin });
  },
};

export default plugin;

export { woabotPlugin } from "./src/channel.js";
export { runtimeStore, getWoaBotRuntime } from "./src/runtime.js";
export * from "./src/types.js";
export * from "./src/config.js";
export * from "./src/gateway.js";
export * from "./src/outbound.js";
export * from "./src/onboarding.js";
