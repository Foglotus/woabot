/**
 * WOA Bot 账户配置（原始配置文件中的字段）
 */
export interface WoaBotAccountConfig {
  enabled?: boolean;
  name?: string;
  /** Lark SDK appId（可任意值，server 会生成 token） */
  appId?: string;
  /** Lark SDK appSecret（可任意值，与 server 的 verificationToken 对应） */
  appSecret?: string;
  /** server 地址，如 http://localhost:10086 */
  domain?: string;
  /** 事件签名校验 token（对应 server 的 LARK_VERIFICATION_TOKEN） */
  verificationToken?: string;
  /** 事件加密 key（对应 server 的 LARK_ENCRYPT_KEY，为空则不加密） */
  encryptKey?: string;
  /** 连接模式：websocket（推荐）或 webhook */
  connectionMode?: "websocket" | "webhook";
  /** webhook 模式下监听的端口 */
  webhookPort?: number;
  /** webhook 模式下的路径 */
  webhookPath?: string;
  dmPolicy?: "open" | "pairing" | "allowlist";
  allowFrom?: string[];
  /** 系统提示词，会添加在用户消息前面 */
  systemPrompt?: string;
}

/**
 * 解析后的 WOA Bot 账户
 */
export interface ResolvedWoaBotAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  appId: string;
  appSecret: string;
  secretSource: "config" | "env" | "none";
  domain: string;
  verificationToken: string;
  encryptKey: string;
  connectionMode: "websocket" | "webhook";
  webhookPort: number;
  webhookPath: string;
  /** 系统提示词 */
  systemPrompt?: string;
  config: WoaBotAccountConfig;
}
