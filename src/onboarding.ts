import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingStatus,
  ChannelOnboardingConfigureContext,
  ChannelOnboardingResult,
  ChannelOnboardingStatusContext,
  OpenClawConfig,
  WizardPrompter,
} from "openclaw/plugin-sdk";

import { CHANNEL_KEY, DEFAULT_ACCOUNT_ID, resolveWoaBotAccount, listWoaBotAccountIds, applyWoaBotAccountConfig } from "./config.js";

// ── helpers ──

function isConfigured(cfg: OpenClawConfig): boolean {
  const ids = listWoaBotAccountIds(cfg);
  return ids.some((id) => {
    const account = resolveWoaBotAccount(cfg, id);
    return Boolean(account.appId && account.appSecret);
  });
}

// ── adapter ──

export const woabotOnboardingAdapter: ChannelOnboardingAdapter = {
  getStatus: async (ctx: ChannelOnboardingStatusContext): Promise<ChannelOnboardingStatus> => {
    const { config: cfg } = ctx;
    const configured = isConfigured(cfg);

    if (configured) {
      const account = resolveWoaBotAccount(cfg, DEFAULT_ACCOUNT_ID);
      return {
        channel: CHANNEL_KEY,
        configured: true,
        statusLines: [
          `App ID: ${account.appId}`,
          `Server: ${account.domain}`,
          `Mode: ${account.connectionMode}`,
        ],
        selectionHint: "configured",
        quickstartScore: 1,
      };
    }

    return {
      channel: CHANNEL_KEY,
      configured: false,
      statusLines: ["Not configured — needs App ID and App Secret"],
      selectionHint: "needs credentials",
      quickstartScore: 5,
    };
  },

  configure: async (ctx: ChannelOnboardingConfigureContext): Promise<ChannelOnboardingResult> => {
    const { config: cfg, prompter } = ctx;

    if (!prompter) {
      return { success: false, error: "No prompter available (non-interactive mode)" };
    }

    let next = { ...cfg };
    const existing = resolveWoaBotAccount(cfg, DEFAULT_ACCOUNT_ID);

    // ── Step 1: 说明 ──
    await prompter.note(
      [
        "WoA Bot 通过 Server 中转连接 WPS 办公助手。",
        "你需要提供以下信息：",
        "  1. App ID    — WPS 开放平台创建的应用 ID",
        "  2. App Secret — 应用密钥",
        "  3. Server URL — 中转服务地址（默认 http://127.0.0.1:10086）",
      ].join("\n"),
      "WoA Bot 配置",
    );

    // ── Step 2: App ID ──
    const appId = await prompter.text({
      message: "请输入 App ID",
      initialValue: existing.appId || undefined,
      placeholder: "cli_xxxxxxxxxx",
      validate: (v) => (v?.trim() ? undefined : "App ID 不能为空"),
    });

    // ── Step 3: App Secret ──
    const useEnv = Boolean(process.env.WOABOT_APP_SECRET);
    let appSecret = "";

    if (useEnv && existing.secretSource === "env") {
      const keepEnv = await prompter.confirm({
        message: "检测到环境变量 WOABOT_APP_SECRET，是否使用环境变量？",
        initialValue: true,
      });
      if (!keepEnv) {
        appSecret = await prompter.text({
          message: "请输入 App Secret",
          placeholder: "xxxxxxxxxxxxxxxxxxxxxxxx",
          validate: (v) => (v?.trim() ? undefined : "App Secret 不能为空"),
        });
      }
    } else if (existing.appSecret && existing.secretSource === "config") {
      const keep = await prompter.confirm({
        message: "App Secret 已配置，是否保留？",
        initialValue: true,
      });
      if (!keep) {
        appSecret = await prompter.text({
          message: "请输入新的 App Secret",
          placeholder: "xxxxxxxxxxxxxxxxxxxxxxxx",
          validate: (v) => (v?.trim() ? undefined : "App Secret 不能为空"),
        });
      }
    } else {
      appSecret = await prompter.text({
        message: "请输入 App Secret",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxx",
        validate: (v) => (v?.trim() ? undefined : "App Secret 不能为空"),
      });
    }

    // ── Step 4: Server URL ──
    const domain = await prompter.text({
      message: "请输入 Server 地址",
      initialValue: existing.domain || "http://127.0.0.1:10086",
      placeholder: "http://127.0.0.1:10086",
      validate: (v) => {
        const s = v?.trim();
        if (!s) return "Server 地址不能为空";
        if (!s.startsWith("http://") && !s.startsWith("https://")) return "地址必须以 http:// 或 https:// 开头";
        return undefined;
      },
    });

    // ── Step 5: Connection mode ──
    const connectionMode = await prompter.select<"websocket" | "webhook">({
      message: "选择连接模式",
      options: [
        { value: "websocket", label: "WebSocket", hint: "推荐 — 实时双向连接" },
        { value: "webhook", label: "Webhook", hint: "Server 主动推送事件到插件" },
      ],
      initialValue: existing.connectionMode || "websocket",
    });

    // ── Step 6: Apply config ──
    next = applyWoaBotAccountConfig(next, DEFAULT_ACCOUNT_ID, {
      appId: appId.trim(),
      ...(appSecret ? { appSecret: appSecret.trim() } : {}),
      domain: domain.trim().replace(/\/+$/, ""),
    });

    // Write connectionMode into the channel section
    const section = (next.channels?.[CHANNEL_KEY] as Record<string, unknown>) ?? {};
    next.channels = {
      ...next.channels,
      [CHANNEL_KEY]: {
        ...section,
        connectionMode,
        enabled: true,
      },
    };

    // ── Step 7: Webhook specific settings ──
    if (connectionMode === "webhook") {
      const webhookPort = await prompter.text({
        message: "Webhook 监听端口",
        initialValue: String(existing.webhookPort || 3001),
        validate: (v) => {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 1 || n > 65535) return "请输入有效的端口号 (1-65535)";
          return undefined;
        },
      });

      const webhookPath = await prompter.text({
        message: "Webhook 路径",
        initialValue: existing.webhookPath || "/woa/events",
        validate: (v) => (v?.trim()?.startsWith("/") ? undefined : "路径必须以 / 开头"),
      });

      const webhookSection = (next.channels?.[CHANNEL_KEY] as Record<string, unknown>) ?? {};
      next.channels = {
        ...next.channels,
        [CHANNEL_KEY]: {
          ...webhookSection,
          webhookPort: Number(webhookPort),
          webhookPath: webhookPath.trim(),
        },
      };
    }

    // ── Done ──
    await prompter.note(
      [
        `App ID:   ${appId.trim()}`,
        `Server:   ${domain.trim()}`,
        `Mode:     ${connectionMode}`,
        appSecret ? "Secret:   (已配置)" : "Secret:   (使用环境变量)",
      ].join("\n"),
      "配置完成",
    );

    return {
      success: true,
      config: next,
    };
  },

  disable: (cfg: OpenClawConfig): OpenClawConfig => {
    const section = (cfg.channels?.[CHANNEL_KEY] as Record<string, unknown>) ?? {};
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        [CHANNEL_KEY]: {
          ...section,
          enabled: false,
        },
      },
    };
  },
};
