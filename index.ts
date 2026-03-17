import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { woabotPlugin } from "./src/channel.js";
import { setWoaBotRuntime } from "./src/runtime.js";

const plugin = {
  id: "woabot",
  name: "WOA Bot",
  description: "WOA Bot channel plugin — connects to WPS via server's Lark-compatible API",
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
export * from "./src/client.js";
export * from "./src/config.js";
export * from "./src/gateway.js";
export * from "./src/outbound.js";
