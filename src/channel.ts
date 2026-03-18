import {
  type ChannelPlugin,
  type OpenClawConfig,
  applyAccountNameToChannelSection,
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk";

import type { ResolvedWoaBotAccount } from "./types.js";
import { DEFAULT_ACCOUNT_ID, CHANNEL_KEY, listWoaBotAccountIds, resolveWoaBotAccount, applyWoaBotAccountConfig, resolveDefaultWoaBotAccountId } from "./config.js";
import { sendText, sendMedia } from "./outbound.js";
import { startGateway } from "./gateway.js";
import { getWoaBotRuntime } from "./runtime.js";
import { woabotOnboardingAdapter } from "./onboarding.js";

/**
 * 简单的文本分块函数
 */
function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0 || splitAt < limit * 0.5) {
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt <= 0 || splitAt < limit * 0.5) {
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

export const woabotPlugin: ChannelPlugin<ResolvedWoaBotAccount> = {
  id: CHANNEL_KEY,
  meta: {
    id: CHANNEL_KEY,
    label: "WOA Bot",
    selectionLabel: "WOA Bot",
    docsPath: "/docs/channels/woabot",
    blurb: "通过 Server 中转连接 WPS 办公助手",
    order: 50,
  },
  onboarding: woabotOnboardingAdapter,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: false,
    reactions: false,
    threads: false,
    blockStreaming: false,
  },
  reload: { configPrefixes: [`channels.${CHANNEL_KEY}`] },

  config: {
    listAccountIds: (cfg) => listWoaBotAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveWoaBotAccount(cfg, accountId),
    defaultAccountId: (cfg) => resolveDefaultWoaBotAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: CHANNEL_KEY,
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: CHANNEL_KEY,
        accountId,
        clearBaseFields: ["appId", "appSecret", "domain", "name"],
      }),
    isConfigured: (account) => Boolean(account?.appId && account?.appSecret),
    describeAccount: (account) => ({
      accountId: account?.accountId ?? DEFAULT_ACCOUNT_ID,
      name: account?.name,
      enabled: account?.enabled ?? false,
      configured: Boolean(account?.appId && account?.appSecret),
      tokenSource: account?.secretSource,
    }),
    resolveAllowFrom: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string }) => {
      const account = resolveWoaBotAccount(cfg, accountId);
      const allowFrom = account.config?.allowFrom ?? [];
      return allowFrom.map((entry: string | number) => String(entry));
    },
    formatAllowFrom: ({ allowFrom }: { allowFrom: Array<string | number> }) =>
      allowFrom
        .map((entry: string | number) => String(entry).trim())
        .filter(Boolean)
        .map((entry: string) => entry.replace(new RegExp(`^${CHANNEL_KEY}:`, "i"), "")),
  },
  setup: {
    resolveAccountId: ({ accountId }) => accountId?.trim().toLowerCase() || DEFAULT_ACCOUNT_ID,
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: CHANNEL_KEY,
        accountId,
        name,
      }),
    validateInput: ({ input }) => {
      if (!input.token && !input.useEnv) {
        return "WOA Bot requires --token (format: appId:appSecret) or --use-env";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      let appId = "";
      let appSecret = "";

      if (input.token) {
        const parts = input.token.split(":");
        if (parts.length === 2) {
          appId = parts[0];
          appSecret = parts[1];
        }
      }

      return applyWoaBotAccountConfig(cfg, accountId, {
        appId,
        appSecret,
        name: input.name,
      });
    },
  },
  messaging: {
    /**
     * 规范化目标地址
     * 支持格式：
     * - woabot:group:{chat_id} → 群聊
     * - woabot:{user_id}      → 私聊
     * - group:{chat_id}       → 群聊
     * - 纯 user_id            → 私聊
     */
    normalizeTarget: (target: string): string | undefined => {
      const id = target.replace(new RegExp(`^${CHANNEL_KEY}:`, "i"), "");

      if (id.startsWith("group:")) {
        return `${CHANNEL_KEY}:${id}`;
      }

      if (id.length > 0) {
        return `${CHANNEL_KEY}:${id}`;
      }

      return undefined;
    },
    targetResolver: {
      looksLikeId: (id: string): boolean => {
        if (new RegExp(`^${CHANNEL_KEY}:(group:)?`, "i").test(id)) return true;
        if (/^group:/i.test(id)) return true;
        return id.length > 0 && !id.includes(" ");
      },
      hint: `WOA Bot 目标格式: ${CHANNEL_KEY}:group:{chat_id} (群聊) 或 ${CHANNEL_KEY}:{user_id} (私聊)`,
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: chunkText,
    chunkerMode: "markdown",
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId, replyToId, cfg }) => {
      const account = resolveWoaBotAccount(cfg, accountId);
      const result = await sendText({ to, text, accountId, replyToId, account });
      return {
        channel: CHANNEL_KEY,
        messageId: result.messageId,
        error: result.error ? new Error(result.error) : undefined,
      };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId, cfg }) => {
      const account = resolveWoaBotAccount(cfg, accountId);
      const result = await sendMedia({ to, text: text ?? "", mediaUrl: mediaUrl ?? "", accountId, replyToId, account });
      return {
        channel: CHANNEL_KEY,
        messageId: result.messageId,
        error: result.error ? new Error(result.error) : undefined,
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const { account, abortSignal, log, cfg } = ctx;

      log?.info(`[woabot:${account.accountId}] Starting gateway — domain=${account.domain}, mode=${account.connectionMode}`);

      await startGateway({
        account,
        abortSignal,
        cfg,
        log,
        onReady: () => {
          log?.info(`[woabot:${account.accountId}] Gateway ready`);
          ctx.setStatus({
            ...ctx.getStatus(),
            running: true,
            connected: true,
            lastConnectedAt: Date.now(),
          });
        },
        onError: (error) => {
          log?.error(`[woabot:${account.accountId}] Gateway error: ${error.message}`);
          ctx.setStatus({
            ...ctx.getStatus(),
            lastError: error.message,
          });
        },
      });
    },
    logoutAccount: async ({ accountId, cfg }) => {
      const nextCfg = { ...cfg } as OpenClawConfig;
      const section = cfg.channels?.[CHANNEL_KEY] ? { ...(cfg.channels[CHANNEL_KEY] as Record<string, unknown>) } : undefined;
      let cleared = false;
      let changed = false;

      if (section) {
        if (accountId === DEFAULT_ACCOUNT_ID && section.appSecret) {
          delete section.appSecret;
          cleared = true;
          changed = true;
        }
        const accounts = section.accounts as Record<string, Record<string, unknown>> | undefined;
        if (accounts && accountId in accounts) {
          const entry = accounts[accountId];
          if (entry && "appSecret" in entry) {
            delete entry.appSecret;
            cleared = true;
            changed = true;
          }
          if (entry && Object.keys(entry).length === 0) {
            delete accounts[accountId];
            changed = true;
          }
        }
      }

      if (changed && section) {
        nextCfg.channels = { ...nextCfg.channels, [CHANNEL_KEY]: section };
        const runtime = getWoaBotRuntime();
        const configApi = runtime.config as { writeConfigFile: (cfg: OpenClawConfig) => Promise<void> };
        await configApi.writeConfigFile(nextCfg);
      }

      const resolved = resolveWoaBotAccount(changed ? nextCfg : cfg, accountId);
      const loggedOut = resolved.secretSource === "none";
      const envToken = Boolean(process.env.WOABOT_APP_SECRET);

      return { ok: true, cleared, envToken, loggedOut };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastConnectedAt: null,
      lastError: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    },
    buildChannelSummary: ({ snapshot }: { snapshot: Record<string, unknown> }) => ({
      configured: snapshot.configured ?? false,
      tokenSource: snapshot.tokenSource ?? "none",
      running: snapshot.running ?? false,
      connected: snapshot.connected ?? false,
      lastConnectedAt: snapshot.lastConnectedAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }: { account?: ResolvedWoaBotAccount; runtime?: Record<string, unknown> }) => ({
      accountId: account?.accountId ?? DEFAULT_ACCOUNT_ID,
      name: account?.name,
      enabled: account?.enabled ?? false,
      configured: Boolean(account?.appId && account?.appSecret),
      tokenSource: account?.secretSource,
      running: runtime?.running ?? false,
      connected: runtime?.connected ?? false,
      lastConnectedAt: runtime?.lastConnectedAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
    }),
  },
};
