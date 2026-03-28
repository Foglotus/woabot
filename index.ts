import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { woabotPlugin } from "./src/channel.js";
import { setWoaBotRuntime } from "./src/runtime.js";

const plugin = {
  id: "woabot",
  name: "WOA Bot",
  description: "基于金山协作的个人助手聊天机器人",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWoaBotRuntime(api.runtime);
    api.registerChannel({ plugin: woabotPlugin });
  },
};

export default plugin;

export { woabotPlugin } from "./src/channel.js";
export { setWoaBotRuntime, getWoaBotRuntime } from "./src/runtime.js";
export * from "./src/types.js";
export * from "./src/config.js";
export * from "./src/gateway.js";
export * from "./src/outbound.js";
export * from "./src/onboarding.js";
