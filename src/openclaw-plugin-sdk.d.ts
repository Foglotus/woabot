/**
 * OpenClaw Plugin SDK 类型声明
 *
 * 此文件为 openclaw/plugin-sdk 模块提供 TypeScript 类型声明
 * 仅包含本项目实际使用的类型和函数
 */

declare module "openclaw/plugin-sdk" {
  // ============ 配置类型 ============

  export interface OpenClawConfig {
    channels?: {
      woabot?: unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  // ============ 插件运行时 ============

  export interface PluginRuntime {
    getConfig(): OpenClawConfig;
    setConfig(config: OpenClawConfig): void;
    getDataDir(): string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    channel?: any;
    log: {
      info: (message: string, ...args: unknown[]) => void;
      warn: (message: string, ...args: unknown[]) => void;
      error: (message: string, ...args: unknown[]) => void;
      debug: (message: string, ...args: unknown[]) => void;
    };
    [key: string]: unknown;
  }

  // ============ 插件 API ============

  export interface OpenClawPluginApi {
    runtime: PluginRuntime;
    registerChannel<TAccount = unknown>(options: { plugin: ChannelPlugin<TAccount> }): void;
    registrationMode?: "full" | "setup-only" | "setup-runtime";
    [key: string]: unknown;
  }

  export function emptyPluginConfigSchema(): unknown;

  // ============ Runtime Store ============

  export interface PluginRuntimeStore<T> {
    setRuntime: (runtime: T) => void;
    getRuntime: () => T;
    tryGetRuntime: () => T | null;
  }

  export function createPluginRuntimeStore<T = PluginRuntime>(errorMessage: string): PluginRuntimeStore<T>;

  // ============ 频道插件 ============

  export interface ChannelPluginMeta {
    id: string;
    label: string;
    selectionLabel?: string;
    docsPath?: string;
    blurb?: string;
    order?: number;
    [key: string]: unknown;
  }

  export interface ChannelPluginCapabilities {
    chatTypes?: ("direct" | "group" | "channel")[];
    media?: boolean;
    reactions?: boolean;
    threads?: boolean;
    blockStreaming?: boolean;
    [key: string]: unknown;
  }

  export interface AccountDescription {
    accountId: string;
    name?: string;
    enabled: boolean;
    configured: boolean;
    tokenSource?: string;
    [key: string]: unknown;
  }

  export interface ChannelPluginConfig<TAccount> {
    listAccountIds: (cfg: OpenClawConfig) => string[];
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) => TAccount;
    defaultAccountId: (cfg: OpenClawConfig) => string;
    setAccountEnabled?: (ctx: { cfg: OpenClawConfig; accountId: string; enabled: boolean }) => OpenClawConfig;
    deleteAccount?: (ctx: { cfg: OpenClawConfig; accountId: string }) => OpenClawConfig;
    isConfigured?: (account: TAccount | undefined) => boolean;
    describeAccount?: (account: TAccount | undefined) => AccountDescription;
    [key: string]: unknown;
  }

  export interface SetupInput {
    token?: string;
    tokenFile?: string;
    useEnv?: boolean;
    name?: string;
    [key: string]: unknown;
  }

  export interface ChannelPluginSetup {
    resolveAccountId?: (ctx: { accountId?: string }) => string;
    applyAccountName?: (ctx: { cfg: OpenClawConfig; accountId: string; name: string }) => OpenClawConfig;
    validateInput?: (ctx: { input: SetupInput }) => string | null;
    applyConfig?: (ctx: { cfg: OpenClawConfig; accountId: string; input: SetupInput }) => OpenClawConfig;
    applyAccountConfig?: (ctx: { cfg: OpenClawConfig; accountId: string; input: SetupInput }) => OpenClawConfig;
    [key: string]: unknown;
  }

  export interface TargetResolver {
    looksLikeId?: (id: string) => boolean;
    hint?: string;
  }

  export interface ChannelPluginMessaging {
    normalizeTarget?: (target: string) => string | undefined;
    targetResolver?: TargetResolver;
    [key: string]: unknown;
  }

  export interface SendTextResult {
    channel: string;
    messageId?: string;
    error?: Error;
  }

  export interface SendTextContext {
    to: string;
    text: string;
    accountId?: string;
    replyToId?: string;
    cfg: OpenClawConfig;
  }

  export interface SendMediaContext {
    to: string;
    text?: string;
    mediaUrl?: string;
    accountId?: string;
    replyToId?: string;
    cfg: OpenClawConfig;
  }

  export interface ChannelPluginOutbound {
    deliveryMode?: "direct" | "queued";
    chunker?: (text: string, limit: number) => string[];
    chunkerMode?: "markdown" | "plain";
    textChunkLimit?: number;
    sendText?: (ctx: SendTextContext) => Promise<SendTextResult>;
    sendMedia?: (ctx: SendMediaContext) => Promise<SendTextResult>;
    [key: string]: unknown;
  }

  export interface AccountStatus {
    running?: boolean;
    connected?: boolean;
    lastConnectedAt?: number;
    lastError?: string;
    [key: string]: unknown;
  }

  export interface GatewayStartContext<TAccount = unknown> {
    account: TAccount;
    accountId: string;
    abortSignal: AbortSignal;
    cfg: OpenClawConfig;
    log?: {
      info: (msg: string) => void;
      warn: (msg: string) => void;
      error: (msg: string) => void;
      debug: (msg: string) => void;
    };
    getStatus: () => AccountStatus;
    setStatus: (status: AccountStatus) => void;
    [key: string]: unknown;
  }

  export interface GatewayLogoutContext {
    accountId: string;
    cfg: OpenClawConfig;
    [key: string]: unknown;
  }

  export interface GatewayLogoutResult {
    ok: boolean;
    cleared: boolean;
    updatedConfig?: OpenClawConfig;
    error?: string;
  }

  export interface ChannelPluginGateway<TAccount = unknown> {
    startAccount?: (ctx: GatewayStartContext<TAccount>) => Promise<void>;
    logoutAccount?: (ctx: GatewayLogoutContext) => Promise<GatewayLogoutResult>;
    [key: string]: unknown;
  }

  export interface ChannelPlugin<TAccount = unknown> {
    id: string;
    meta?: ChannelPluginMeta;
    version?: string;
    capabilities?: ChannelPluginCapabilities;
    reload?: { configPrefixes?: string[] };
    onboarding?: ChannelOnboardingAdapter;
    config?: ChannelPluginConfig<TAccount>;
    setup?: ChannelPluginSetup;
    messaging?: ChannelPluginMessaging;
    outbound?: ChannelPluginOutbound;
    gateway?: ChannelPluginGateway<TAccount>;
    start?: (runtime: PluginRuntime) => void | Promise<void>;
    stop?: () => void | Promise<void>;
    deliver?: (ctx: unknown) => Promise<unknown>;
    status?: unknown;
    [key: string]: unknown;
  }

  // ============ Onboarding 类型 ============

  export interface WizardPrompter {
    intro(title: string): Promise<void>;
    outro(message: string): Promise<void>;
    note(message: string, title?: string): Promise<void>;
    text(params: { message: string; initialValue?: string; placeholder?: string; validate?: (value: string | undefined) => string | undefined }): Promise<string>;
    select<T>(params: { message: string; options: Array<{ value: T; label: string; hint?: string }>; initialValue?: T }): Promise<T>;
    confirm(params: { message: string; initialValue?: boolean }): Promise<boolean>;
  }

  export interface ChannelOnboardingStatus {
    channel?: string;
    configured: boolean;
    statusLines?: string[];
    selectionHint?: string;
    quickstartScore?: number;
    [key: string]: unknown;
  }

  export interface ChannelOnboardingStatusContext {
    config: OpenClawConfig;
    accountId?: string;
    prompter?: unknown;
    [key: string]: unknown;
  }

  export interface ChannelOnboardingConfigureContext {
    config: OpenClawConfig;
    accountId?: string;
    input?: Record<string, unknown>;
    prompter?: WizardPrompter;
    [key: string]: unknown;
  }

  export interface ChannelOnboardingResult {
    success: boolean;
    config?: OpenClawConfig;
    error?: string;
    message?: string;
    [key: string]: unknown;
  }

  export interface ChannelOnboardingAdapter {
    getStatus?: (ctx: ChannelOnboardingStatusContext) => ChannelOnboardingStatus | Promise<ChannelOnboardingStatus>;
    configure?: (ctx: ChannelOnboardingConfigureContext) => ChannelOnboardingResult | Promise<ChannelOnboardingResult>;
    [key: string]: unknown;
  }

  // ============ 配置辅助函数 ============

  export function applyAccountNameToChannelSection(ctx: {
    cfg: OpenClawConfig;
    channelKey: string;
    accountId: string;
    name: string;
  }): OpenClawConfig;

  export function deleteAccountFromConfigSection(ctx: {
    cfg: OpenClawConfig;
    sectionKey: string;
    accountId: string;
    clearBaseFields?: string[];
  }): OpenClawConfig;

  export function setAccountEnabledInConfigSection(ctx: {
    cfg: OpenClawConfig;
    sectionKey: string;
    accountId: string;
    enabled: boolean;
    allowTopLevel?: boolean;
  }): OpenClawConfig;

  export const DEFAULT_ACCOUNT_ID: string;
  export function normalizeAccountId(accountId: string | undefined | null): string;
}
