import type { ResolvedWoaBotAccount } from "./types.js";

/**
 * WOA Bot 消息发送模块
 *
 * 通过 fetch 直接调用 server 的 /open-apis/im/v1/messages 接口发送消息。
 * server 会将消息格式转换为 WPS 格式并调用 WPS OpenAPI。
 */

interface SendResult {
  messageId?: string;
  error?: string;
}

/** Server API 响应结构 */
interface ApiResponse {
  code: number;
  msg?: string;
  data?: { message_id?: string };
}

/**
 * 发送文本消息
 */
export async function sendText(opts: {
  to: string;
  text: string;
  accountId?: string;
  replyToId?: string;
  account: ResolvedWoaBotAccount;
}): Promise<SendResult> {
  const { to, text, replyToId, account } = opts;
  const baseUrl = account.domain.replace(/\/+$/, "");

  // 分块发送
  const chunks = chunkText(text, 4000);

  let lastMessageId: string | undefined;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const content = formatPostContent(chunk);

    try {
      // 第一条消息用 reply，后续用 create
      if (i === 0 && replyToId) {
        const resp = await fetch(`${baseUrl}/open-apis/im/v1/messages/${encodeURIComponent(replyToId)}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ msg_type: "post", content }),
        });
        const json = await resp.json() as ApiResponse;
        if (json.code === 0) {
          lastMessageId = json.data?.message_id;
        } else {
          // reply 失败（消息已被撤回等），降级为 create
          const fallback = await sendCreate(baseUrl, parseChatId(to), content);
          if (fallback.code === 0) {
            lastMessageId = fallback.data?.message_id;
          } else {
            return { error: `send failed: ${fallback.msg}` };
          }
        }
      } else {
        const chatId = parseChatId(to);
        const json = await sendCreate(baseUrl, chatId, content);
        if (json.code === 0) {
          lastMessageId = json.data?.message_id;
        } else {
          return { error: `send failed: ${json.msg}` };
        }
      }
    } catch (err) {
      return { error: String(err) };
    }
  }

  return { messageId: lastMessageId };
}

/**
 * POST /open-apis/im/v1/messages 发送新消息
 */
async function sendCreate(baseUrl: string, chatId: string, content: string): Promise<ApiResponse> {
  const resp = await fetch(`${baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: "post",
      content,
    }),
  });
  return await resp.json() as ApiResponse;
}

/**
 * 发送媒体消息（简化处理，直接发文本+URL）
 */
export async function sendMedia(opts: {
  to: string;
  text: string;
  mediaUrl: string;
  accountId?: string;
  replyToId?: string;
  account: ResolvedWoaBotAccount;
}): Promise<SendResult> {
  const { to, text, mediaUrl, accountId, replyToId, account } = opts;
  const fullText = mediaUrl ? `${text}\n${mediaUrl}`.trim() : text;
  return sendText({ to, text: fullText, accountId, replyToId, account });
}

/**
 * 解析目标地址中的 chat_id
 */
function parseChatId(to: string): string {
  if (to.startsWith("group:")) return to.slice(6);
  if (to.startsWith("woabot:group:")) return to.slice(13);
  if (to.startsWith("woabot:")) return to.slice(7);
  return to;
}

/**
 * 格式化为 post content（rich text markdown）
 */
function formatPostContent(text: string): string {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: "md", text }]],
    },
  });
}

/**
 * 文本分块
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
