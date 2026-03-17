import * as lark from "@larksuiteoapi/node-sdk";
import http from "node:http";
import type { ResolvedWoaBotAccount } from "./types.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getLarkClient, clearClientCache } from "./client.js";
import { getWoaBotRuntime } from "./runtime.js";
import { sendText } from "./outbound.js";
import { CHANNEL_KEY } from "./config.js";

/**
 * WOA Bot Gateway
 *
 * 通过 @larksuiteoapi/node-sdk 连接到 server 的 Lark 兼容层：
 * - WebSocket 模式：使用 Lark.WSClient 连接到 server 的 /ws
 * - Webhook 模式：启动 HTTP 服务器接收 server POST 的事件
 *
 * 收到 im.message.receive_v1 事件后，解析消息并派发到 OpenClaw 框架。
 */

interface GatewayOptions {
  account: ResolvedWoaBotAccount;
  abortSignal: AbortSignal;
  cfg: OpenClawConfig;
  log?: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    debug?: (msg: string) => void;
  };
  onReady: () => void;
  onError: (error: Error) => void;
}

/** Lark 事件中的 message 结构 */
interface LarkMessage {
  message_id: string;
  root_id?: string;
  parent_id?: string;
  create_time?: string;
  chat_id: string;
  chat_type: string;        // "p2p" | "group"
  message_type: string;     // "text" | "post" | "image" | ...
  content: string;           // JSON string
  mentions?: LarkMention[];
}

interface LarkMention {
  key: string;
  id: { open_id?: string; user_id?: string; union_id?: string };
  name: string;
  tenant_key?: string;
}

/** Lark 事件中的 sender 结构 */
interface LarkSender {
  sender_id: { open_id?: string; user_id?: string; union_id?: string };
  sender_type: string;     // "user" | "app"
  tenant_key?: string;
}

/** im.message.receive_v1 事件 data */
interface LarkMessageEventData {
  sender: LarkSender;
  message: LarkMessage;
}

/**
 * 从 Lark 消息 content 中提取纯文本
 */
function extractTextFromContent(messageType: string, contentStr: string): string {
  try {
    const parsed = JSON.parse(contentStr);
    if (messageType === "text") {
      return (parsed.text as string) ?? "";
    }
    if (messageType === "post") {
      // post 格式: { zh_cn: { content: [[{ tag: "text", text: "..." }]] } }
      const locale = parsed.zh_cn ?? parsed.en_us ?? parsed.ja_jp;
      if (locale?.content && Array.isArray(locale.content)) {
        const parts: string[] = [];
        if (locale.title) parts.push(locale.title);
        for (const line of locale.content) {
          if (!Array.isArray(line)) continue;
          for (const el of line) {
            if (el && typeof el === "object" && "text" in el) {
              parts.push(String(el.text));
            }
          }
        }
        return parts.join("\n");
      }
    }
    // 其他类型，尝试拿 text 字段
    if (typeof parsed.text === "string") return parsed.text;
    return contentStr;
  } catch {
    return contentStr;
  }
}

/**
 * 启动网关
 */
export async function startGateway(options: GatewayOptions): Promise<void> {
  const { account, abortSignal, cfg, log, onReady, onError } = options;

  if (abortSignal.aborted) return;

  // 创建事件分发器
  const eventDispatcher = new lark.EventDispatcher({
    verificationToken: account.verificationToken,
    encryptKey: account.encryptKey || undefined,
  });

  // 注册 im.message.receive_v1 事件处理
  eventDispatcher.register({
    "im.message.receive_v1": async (data) => {
      try {
        await handleIncomingMessage(data, account, cfg, log);
      } catch (err) {
        log?.error(`[woabot:${account.accountId}] Error handling message: ${err}`);
      }
    },
  });

  if (account.connectionMode === "webhook") {
    await startWebhookMode(eventDispatcher, options);
  } else {
    await startWebSocketMode(eventDispatcher, options);
  }
}

/**
 * WebSocket 模式：使用 Lark.WSClient 连接到 server
 */
async function startWebSocketMode(
  eventDispatcher: lark.EventDispatcher,
  options: GatewayOptions,
): Promise<void> {
  const { account, abortSignal, log, onReady, onError } = options;

  log?.info(`[woabot:${account.accountId}] Starting WebSocket mode → ${account.domain}`);

  const wsClient = new lark.WSClient({
    appId: account.appId,
    appSecret: account.appSecret,
    domain: account.domain,
    autoReconnect: true,
    loggerLevel: lark.LoggerLevel.warn,
  });

  // Lark WSClient.start() 接受 eventDispatcher 参数
  const startPromise = wsClient.start({ eventDispatcher });

  // 连接成功后回调
  // WSClient 没有 onReady 回调，我们在 start() resolve 后认为连接成功
  startPromise
    .then(() => {
      log?.info(`[woabot:${account.accountId}] WebSocket connected`);
      onReady();
    })
    .catch((err: Error) => {
      log?.error(`[woabot:${account.accountId}] WebSocket connection failed: ${err.message}`);
      onError(err);
    });

  // 监听 abort 信号以优雅关闭
  abortSignal.addEventListener("abort", () => {
    log?.info(`[woabot:${account.accountId}] Shutting down WebSocket gateway`);
    clearClientCache(account.accountId);
  }, { once: true });
}

/**
 * Webhook 模式：启动 HTTP 服务器接收事件
 */
async function startWebhookMode(
  eventDispatcher: lark.EventDispatcher,
  options: GatewayOptions,
): Promise<void> {
  const { account, abortSignal, log, onReady, onError } = options;

  const port = account.webhookPort;
  const path = account.webhookPath;
  log?.info(`[woabot:${account.accountId}] Starting webhook mode on :${port}${path}`);

  const server = http.createServer(
    lark.adaptDefault(path, eventDispatcher, { autoChallenge: true })
  );

  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => {
      log?.info(`[woabot:${account.accountId}] Webhook server listening on :${port}${path}`);
      onReady();
      resolve();
    });
    server.on("error", (err) => {
      log?.error(`[woabot:${account.accountId}] Webhook server error: ${err.message}`);
      onError(err);
      reject(err);
    });
  });

  abortSignal.addEventListener("abort", () => {
    log?.info(`[woabot:${account.accountId}] Shutting down webhook server`);
    server.close();
    clearClientCache(account.accountId);
  }, { once: true });
}

/**
 * 处理收到的 Lark 消息事件
 */
async function handleIncomingMessage(
  data: {
    sender: {
      sender_id?: { open_id?: string; user_id?: string; union_id?: string };
      sender_type: string;
      tenant_key?: string;
    };
    message: {
      message_id: string;
      root_id?: string;
      parent_id?: string;
      create_time: string;
      chat_id: string;
      chat_type: string;
      message_type: string;
      content: string;
      mentions?: Array<{ key: string; id: { open_id?: string; user_id?: string; union_id?: string }; name: string }>;
    };
  },
  account: ResolvedWoaBotAccount,
  cfg: OpenClawConfig,
  log?: GatewayOptions["log"],
): Promise<void> {
  const { sender, message } = data;
  const senderId = sender.sender_id?.open_id ?? sender.sender_id?.user_id ?? "unknown";
  const chatId = message.chat_id;
  const isGroupChat = message.chat_type === "group";
  const textContent = extractTextFromContent(message.message_type, message.content);

  log?.info(`[woabot:${account.accountId}] Message from ${senderId} in ${chatId} (${message.chat_type}): ${textContent.slice(0, 100)}`);

  const pluginRuntime = getWoaBotRuntime();

  // 记录活动
  pluginRuntime.channel.activity.record({
    channel: CHANNEL_KEY,
    accountId: account.accountId,
    direction: "inbound",
  });

  // 解析路由
  const peerId = isGroupChat ? chatId : senderId;
  const route = pluginRuntime.channel.routing.resolveAgentRoute({
    cfg,
    channel: CHANNEL_KEY,
    accountId: account.accountId,
    peer: {
      kind: isGroupChat ? "group" : "direct",
      id: peerId,
    },
  });

  const envelopeOptions = pluginRuntime.channel.reply.resolveEnvelopeFormatOptions(cfg);

  // 收集系统提示
  const systemPrompts: string[] = [];
  if (account.systemPrompt) {
    systemPrompts.push(account.systemPrompt);
  }

  // 组装 From/To 地址
  const fromAddress = isGroupChat ? `${CHANNEL_KEY}:group:${chatId}:${senderId}` : `${CHANNEL_KEY}:${senderId}`;
  const toAddress = isGroupChat ? `${CHANNEL_KEY}:group:${chatId}` : `${CHANNEL_KEY}:${senderId}`;

  // 用户消息内容
  const userContent = textContent.trim();
  if (!userContent) {
    log?.debug?.(`[woabot:${account.accountId}] Empty message, skipping`);
    return;
  }

  // 格式化信封
  const body = pluginRuntime.channel.reply.formatInboundEnvelope({
    envelopeOptions,
    text: userContent,
    channel: CHANNEL_KEY,
    accountId: account.accountId,
    sessionKey: route.sessionKey,
    from: fromAddress,
    to: toAddress,
    chatType: isGroupChat ? "group" : "direct",
    senderId,
    messageId: message.message_id,
  });

  // 构建 agentBody
  const agentBody = userContent.startsWith("/")
    ? userContent
    : systemPrompts.length > 0
      ? `${systemPrompts.join("\n\n")}\n\n${userContent}`
      : userContent;

  // 最终上下文
  const ctxPayload = pluginRuntime.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: agentBody,
    RawBody: textContent,
    CommandBody: textContent,
    From: fromAddress,
    To: toAddress,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroupChat ? "group" : "direct",
    SenderId: senderId,
    SenderName: undefined,
    Provider: CHANNEL_KEY,
    Surface: CHANNEL_KEY,
    MessageSid: message.message_id,
    Timestamp: message.create_time ? Number(message.create_time) : Date.now(),
    OriginatingChannel: CHANNEL_KEY,
    OriginatingTo: toAddress,
    CommandAuthorized: true,
  });

  // 确定发送目标
  const targetTo = isGroupChat ? `group:${chatId}` : senderId;
  const replyToId = message.message_id;

  try {
    const messagesConfig = pluginRuntime.channel.reply.resolveEffectiveMessagesConfig(cfg, route.agentId);

    let hasResponse = false;
    let hasBlockResponse = false;
    const responseTimeout = 120000;

    const timeoutPromise = new Promise<void>((_, reject) => {
      const id = setTimeout(() => {
        if (!hasResponse) reject(new Error("Response timeout"));
      }, responseTimeout);
      // 清理引用以避免内存泄漏
      if (typeof id === "object" && "unref" in id) (id as NodeJS.Timeout).unref();
    });

    const dispatchPromise = pluginRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg,
      dispatcherOptions: {
        responsePrefix: messagesConfig.responsePrefix,
        deliver: async (payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string }, info: { kind: string }) => {
          hasResponse = true;

          log?.info(`[woabot:${account.accountId}] deliver: kind=${info.kind}, text.length=${payload.text?.length ?? 0}`);

          // 跳过 tool 中间结果
          if (info.kind === "tool") {
            log?.debug?.(`[woabot:${account.accountId}] Skipping tool deliver`);
            return;
          }

          hasBlockResponse = true;

          if (payload.text) {
            try {
              const result = await sendText({ to: targetTo, text: payload.text, accountId: account.accountId, replyToId, account });
              log?.info(`[woabot:${account.accountId}] Sent reply: messageId=${result.messageId}`);

              pluginRuntime.channel.activity.record({
                channel: CHANNEL_KEY,
                accountId: account.accountId,
                direction: "outbound",
              });
            } catch (sendErr) {
              log?.error(`[woabot:${account.accountId}] Send failed: ${sendErr}`);
            }
          }
        },
      },
    });

    await Promise.race([dispatchPromise, timeoutPromise]);

    // dispatch 完成但没有 block 响应，发兜底
    if (!hasBlockResponse && hasResponse) {
      log?.info(`[woabot:${account.accountId}] No block response, sending fallback`);
      try {
        await sendText({
          to: targetTo,
          text: "🔧 处理中…",
          accountId: account.accountId,
          replyToId,
          account,
        });
      } catch (e) {
        log?.error(`[woabot:${account.accountId}] Fallback send failed: ${e}`);
      }
    }
  } catch (err) {
    log?.error(`[woabot:${account.accountId}] Dispatch error: ${err}`);

    // 发送错误提示
    try {
      await sendText({
        to: targetTo,
        text: `抱歉，处理消息时出错了：${String(err).slice(0, 200)}`,
        accountId: account.accountId,
        replyToId,
        account,
      });
    } catch (sendErr) {
      log?.error(`[woabot:${account.accountId}] Error message send failed: ${sendErr}`);
    }
  }
}
