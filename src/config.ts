import type { ResolvedWoaBotAccount, WoaBotAccountConfig } from "./types.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

export const DEFAULT_ACCOUNT_ID = "default";
export const CHANNEL_KEY = "woabot";

interface WoaBotChannelConfig extends WoaBotAccountConfig {
  accounts?: Record<string, WoaBotAccountConfig>;
}

function normalizeStr(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

/**
 * 列出所有 WOA Bot 账户 ID
 */
export function listWoaBotAccountIds(cfg: OpenClawConfig): string[] {
  const ids = new Set<string>();
  const section = cfg.channels?.[CHANNEL_KEY] as WoaBotChannelConfig | undefined;

  if (section?.appId) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }

  if (section?.accounts) {
    for (const accountId of Object.keys(section.accounts)) {
      if (section.accounts[accountId]?.appId) {
        ids.add(accountId);
      }
    }
  }

  return Array.from(ids);
}

/**
 * 获取默认账户 ID
 */
export function resolveDefaultWoaBotAccountId(cfg: OpenClawConfig): string {
  const section = cfg.channels?.[CHANNEL_KEY] as WoaBotChannelConfig | undefined;
  if (section?.appId) return DEFAULT_ACCOUNT_ID;
  if (section?.accounts) {
    const ids = Object.keys(section.accounts);
    if (ids.length > 0) return ids[0];
  }
  return DEFAULT_ACCOUNT_ID;
}

/**
 * 解析 WOA Bot 账户配置
 */
export function resolveWoaBotAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedWoaBotAccount {
  const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
  const section = cfg.channels?.[CHANNEL_KEY] as WoaBotChannelConfig | undefined;

  let accountConfig: WoaBotAccountConfig = {};
  let appId = "";
  let appSecret = "";
  let secretSource: "config" | "env" | "none" = "none";

  if (resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    accountConfig = {
      enabled: section?.enabled,
      name: section?.name,
      appId: section?.appId,
      appSecret: section?.appSecret,
      domain: section?.domain,
      verificationToken: section?.verificationToken,
      encryptKey: section?.encryptKey,
      connectionMode: section?.connectionMode,
      webhookPort: section?.webhookPort,
      webhookPath: section?.webhookPath,
      dmPolicy: section?.dmPolicy,
      allowFrom: section?.allowFrom,
      systemPrompt: section?.systemPrompt,
    };
    appId = normalizeStr(section?.appId);
  } else {
    const account = section?.accounts?.[resolvedAccountId];
    accountConfig = account ?? {};
    appId = normalizeStr(account?.appId);
  }

  // 解析 appSecret
  if (accountConfig.appSecret) {
    appSecret = accountConfig.appSecret;
    secretSource = "config";
  } else if (process.env.WOABOT_APP_SECRET && resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    appSecret = process.env.WOABOT_APP_SECRET;
    secretSource = "env";
  }

  // appId 也可以从环境变量读取
  if (!appId && process.env.WOABOT_APP_ID && resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    appId = normalizeStr(process.env.WOABOT_APP_ID);
  }

  const domain = normalizeStr(accountConfig.domain)
    || process.env.WOA_SERVER_URL
    || process.env.WOABOT_DOMAIN
    || "http://127.0.0.1:10086";

  return {
    accountId: resolvedAccountId,
    name: accountConfig.name,
    enabled: accountConfig.enabled !== false,
    appId,
    appSecret,
    secretSource,
    domain: domain.replace(/\/+$/, ""),
    verificationToken: normalizeStr(accountConfig.verificationToken)
      || process.env.WOABOT_VERIFICATION_TOKEN
      || "woa_local_token",
    encryptKey: normalizeStr(accountConfig.encryptKey)
      || process.env.WOABOT_ENCRYPT_KEY
      || "",
    connectionMode: accountConfig.connectionMode ?? "websocket",
    webhookPort: accountConfig.webhookPort ?? 3001,
    webhookPath: accountConfig.webhookPath ?? "/woa/events",
    systemPrompt: accountConfig.systemPrompt,
    config: accountConfig,
  };
}

/**
 * 应用账户配置
 */
export function applyWoaBotAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
  input: { appId?: string; appSecret?: string; domain?: string; name?: string },
): OpenClawConfig {
  const next = { ...cfg };

  if (accountId === DEFAULT_ACCOUNT_ID) {
    const existingConfig = (next.channels?.[CHANNEL_KEY] as WoaBotChannelConfig) || {};
    const allowFrom = existingConfig.allowFrom ?? ["*"];

    next.channels = {
      ...next.channels,
      [CHANNEL_KEY]: {
        ...(next.channels?.[CHANNEL_KEY] as Record<string, unknown> || {}),
        enabled: true,
        allowFrom,
        ...(input.appId ? { appId: input.appId } : {}),
        ...(input.appSecret ? { appSecret: input.appSecret } : {}),
        ...(input.domain ? { domain: input.domain } : {}),
        ...(input.name ? { name: input.name } : {}),
      },
    };
  } else {
    const existingAccountConfig =
      (next.channels?.[CHANNEL_KEY] as WoaBotChannelConfig)?.accounts?.[accountId] || {};
    const allowFrom = existingAccountConfig.allowFrom ?? ["*"];

    next.channels = {
      ...next.channels,
      [CHANNEL_KEY]: {
        ...(next.channels?.[CHANNEL_KEY] as Record<string, unknown> || {}),
        enabled: true,
        accounts: {
          ...((next.channels?.[CHANNEL_KEY] as WoaBotChannelConfig)?.accounts || {}),
          [accountId]: {
            ...((next.channels?.[CHANNEL_KEY] as WoaBotChannelConfig)?.accounts?.[accountId] || {}),
            enabled: true,
            allowFrom,
            ...(input.appId ? { appId: input.appId } : {}),
            ...(input.appSecret ? { appSecret: input.appSecret } : {}),
            ...(input.domain ? { domain: input.domain } : {}),
            ...(input.name ? { name: input.name } : {}),
          },
        },
      },
    };
  }

  return next;
}
