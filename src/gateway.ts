import WebSocket from "ws";
import http from "node:http";
import crypto from "node:crypto";
import type { ResolvedWoaBotAccount } from "./types.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getWoaBotRuntime } from "./runtime.js";
import { sendText } from "./outbound.js";
import { CHANNEL_KEY } from "./config.js";

/**
 * WOA Bot Gateway
 *
 * 直接连接 server 的 WebSocket / HTTP 接口（不使用飞书 SDK）：
 * - WebSocket 模式：先调用 /callback/ws/endpoint 获取 WS URL，再用 ws 包连接
 * - Webhook 模式：启动 HTTP 服务器接收 server POST 的事件 JSON
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

/** Server 推送的 WS event envelope */
interface WSEventEnvelope {
  type: string;
  message_id?: string;
  data?: WoaBotV2Event;
}

/** WoA Bot v2 事件结构 (im.message.receive_v1) */
interface WoaBotV2Event {
  schema?: string;
  header?: {
    event_id: string;
    event_type: string;
    create_time?: string;
    token?: string;
    app_id?: string;
  };
  event?: {
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
  };
}

/**
 * 从消息 content 中提取纯文本
 */
function extractTextFromContent(messageType: string, contentStr: string): string {
  try {
    const parsed = JSON.parse(contentStr);
    if (messageType === "text") {
      return (parsed.text as string) ?? "";
    }
    if (messageType === "post") {
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
  const { account, abortSignal } = options;
  if (abortSignal.aborted) return;

  if (account.connectionMode === "webhook") {
    await startWebhookMode(options);
  } else {
    await startWebSocketMode(options);
  }
}

// ─── WebSocket 模式 ──────────────────────────────────────────────────

/**
 * 调用 /callback/ws/endpoint 获取 WebSocket URL
 */
async function fetchWSEndpoint(account: ResolvedWoaBotAccount): Promise<{
  url: string;
  config: { PingInterval: number; ReconnectInterval: number };
}> {
  const endpointUrl = `${account.domain.replace(/\/+$/, "")}/callback/ws/endpoint`;
  const resp = await fetch(endpointUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ AppID: account.appId, AppSecret: account.appSecret }),
  });

  if (!resp.ok) {
    throw new Error(`WS endpoint handshake failed: ${resp.status} ${resp.statusText}`);
  }

  const json = await resp.json() as {
    code: number;
    msg?: string;
    data?: { URL?: string; ClientConfig?: Record<string, number> };
  };

  if (json.code !== 0 || !json.data?.URL) {
    throw new Error(`WS endpoint error: code=${json.code} msg=${json.msg}`);
  }

  return {
    url: json.data.URL,
    config: {
      PingInterval: json.data.ClientConfig?.PingInterval ?? 120,
      ReconnectInterval: json.data.ClientConfig?.ReconnectInterval ?? 120,
    },
  };
}

/**
 * WebSocket 模式：直接连接 server 的 /ws 端点
 */
async function startWebSocketMode(options: GatewayOptions): Promise<void> {
  const { account, abortSignal, cfg, log, onReady, onError } = options;

  log?.info(`[woabot:${account.accountId}] Starting WebSocket mode → ${account.domain}`);

  let endpoint: Awaited<ReturnType<typeof fetchWSEndpoint>>;
  try {
    endpoint = await fetchWSEndpoint(account);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log?.error(`[woabot:${account.accountId}] WS handshake failed: ${error.message}`);
    onError(error);
    return;
  }

  log?.info(`[woabot:${account.accountId}] Connecting to ${endpoint.url}`);

  const connectWS = () => {
    if (abortSignal.aborted) return;

    const ws = new WebSocket(endpoint.url);

    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let connected = false;

    ws.on("open", () => {
      connected = true;
      log?.info(`[woabot:${account.accountId}] WebSocket connected`);
      onReady();

      // 定期发送 ping
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, endpoint.config.PingInterval * 1000);
    });

    ws.on("message", (rawData) => {
      try {
        const text = typeof rawData === "string" ? rawData : rawData.toString("utf-8");
        const envelope = JSON.parse(text) as WSEventEnvelope;

        if (envelope.type === "pong") {
          log?.debug?.(`[woabot:${account.accountId}] Pong received`);
          return;
        }

        if (envelope.type === "event" && envelope.data) {
          // 发送 ack
          if (envelope.message_id) {
            ws.send(JSON.stringify({ type: "ack", message_id: envelope.message_id }));
          }

          // 处理事件
          const event = envelope.data;
          if (event.header?.event_type === "im.message.receive_v1" && event.event) {
            handleIncomingMessage(event.event, account, cfg, log).catch((err) => {
              log?.error(`[woabot:${account.accountId}] Error handling message: ${err}`);
            });
          }
        }
      } catch (err) {
        log?.error(`[woabot:${account.accountId}] Failed to parse WS message: ${err}`);
      }
    });

    ws.on("close", (code, reason) => {
      if (pingTimer) clearInterval(pingTimer);
      log?.info(`[woabot:${account.accountId}] WebSocket closed: ${code} ${reason?.toString()}`);

      // 自动重连
      if (!abortSignal.aborted) {
        const delay = (endpoint.config.ReconnectInterval + Math.random() * 30) * 1000;
        log?.info(`[woabot:${account.accountId}] Reconnecting in ${Math.round(delay / 1000)}s...`);
        setTimeout(connectWS, delay);
      }
    });

    ws.on("error", (err) => {
      log?.error(`[woabot:${account.accountId}] WebSocket error: ${err.message}`);
      if (!connected) {
        onError(err);
      }
    });

    // 监听 abort 信号
    abortSignal.addEventListener("abort", () => {
      log?.info(`[woabot:${account.accountId}] Shutting down WebSocket gateway`);
      if (pingTimer) clearInterval(pingTimer);
      ws.close(1000, "gateway shutdown");
    }, { once: true });
  };

  connectWS();
}

// ─── Webhook 模式 ────────────────────────────────────────────────────

/**
 * Webhook 模式：启动 HTTP 服务器接收 server POST 的事件
 */
async function startWebhookMode(options: GatewayOptions): Promise<void> {
  const { account, abortSignal, cfg, log, onReady, onError } = options;

  const port = account.webhookPort;
  const path = account.webhookPath;
  log?.info(`[woabot:${account.accountId}] Starting webhook mode on :${port}${path}`);

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== path) {
      res.writeHead(404);
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const bodyStr = Buffer.concat(chunks).toString("utf-8");
        const body = JSON.parse(bodyStr) as Record<string, unknown>;

        // URL verification challenge
        if (body.challenge) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ challenge: body.challenge }));
          return;
        }

        // 解密（如果有 encrypt 字段且配置了 encryptKey）
        let event: WoaBotV2Event;
        if (body.encrypt && account.encryptKey) {
          const decrypted = decryptEvent(body.encrypt as string, account.encryptKey);
          event = JSON.parse(decrypted) as WoaBotV2Event;
        } else {
          event = body as unknown as WoaBotV2Event;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 0 }));

        // 验证 token
        if (account.verificationToken && event.header?.token !== account.verificationToken) {
          log?.error(`[woabot:${account.accountId}] Invalid verification token`);
          return;
        }

        // 处理事件
        if (event.header?.event_type === "im.message.receive_v1" && event.event) {
          handleIncomingMessage(event.event, account, cfg, log).catch((err) => {
            log?.error(`[woabot:${account.accountId}] Error handling message: ${err}`);
          });
        }
      } catch (err) {
        log?.error(`[woabot:${account.accountId}] Webhook parse error: ${err}`);
        res.writeHead(400);
        res.end();
      }
    });
  });

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
  }, { once: true });
}

/**
 * 解密 AES-256-CBC 加密事件（与 server 的 encryptWoaBotEvent 对应）
 */
function decryptEvent(encrypted: string, key: string): string {
  const buf = Buffer.from(encrypted, "base64");
  const iv = buf.subarray(0, 16);
  const ciphertext = buf.subarray(16);
  const keyHash = crypto.createHash("sha256").update(key).digest();
  const decipher = crypto.createDecipheriv("aes-256-cbc", keyHash, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

// ─── 消息处理 ────────────────────────────────────────────────────────

/**
 * 处理收到的消息事件
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
