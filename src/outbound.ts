import type { ResolvedWoaBotAccount } from "./types.js";
import { getLarkClient } from "./client.js";

/**
 * WOA Bot 消息发送模块
 *
 * 通过 Lark SDK 调用 server 的 /open-apis/im/v1/messages 接口发送消息。
 * server 会将 Lark 格式转换为 WPS 格式并调用 WPS OpenAPI。
 */

interface SendResult {
  messageId?: string;
  error?: string;
}

/**
 * 发送文本消息
 *
 * @param to - 目标地址（chat_id 或 "group:{chat_id}" 格式）
 * @param text - 消息文本
 * @param replyToId - 回复的消息 ID（优先使用 reply 接口）
 */
export async function sendText(opts: {
  to: string;
  text: string;
  accountId?: string;
  replyToId?: string;
  account: ResolvedWoaBotAccount;
}): Promise<SendResult> {
  const { to, text, replyToId, account } = opts;
  const client = getLarkClient(account);

  // 分块发送（Lark post 格式支持 markdown）
  const chunks = chunkText(text, 4000);

  let lastMessageId: string | undefined;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const content = formatPostContent(chunk);

    try {
      // 第一条消息用 reply，后续用 create
      if (i === 0 && replyToId) {
        const resp = await client.im.v1.message.reply({
          path: { message_id: replyToId },
          data: { msg_type: "post", content },
        });
        lastMessageId = resp?.data?.message_id;
      } else {
        // 解析 chat_id
        const chatId = parseChatId(to);
        const resp = await client.im.v1.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId,
            msg_type: "post",
            content,
          },
        });
        lastMessageId = resp?.data?.message_id;
      }
    } catch (err) {
      const errMsg = String(err);
      // 如果 reply 失败（消息已被撤回等），降级为 create
      if (i === 0 && replyToId && (errMsg.includes("230011") || errMsg.includes("231003"))) {
        try {
          const chatId = parseChatId(to);
          const resp = await client.im.v1.message.create({
            params: { receive_id_type: "chat_id" },
            data: {
              receive_id: chatId,
              msg_type: "post",
              content,
            },
          });
          lastMessageId = resp?.data?.message_id;
        } catch (fallbackErr) {
          return { error: String(fallbackErr) };
        }
      } else {
        return { error: errMsg };
      }
    }
  }

  return { messageId: lastMessageId };
}

/**
 * 发送媒体消息（对 WOA 通道简化处理，直接发文本+URL）
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

  // 将 mediaUrl 附加到文本中
  const fullText = mediaUrl ? `${text}\n${mediaUrl}`.trim() : text;
  return sendText({ to, text: fullText, accountId, replyToId, account });
}

/**
 * 解析目标地址中的 chat_id
 */
function parseChatId(to: string): string {
  // "group:{chat_id}" → chat_id
  if (to.startsWith("group:")) return to.slice(6);
  // "woabot:group:{chat_id}" → chat_id
  if (to.startsWith("woabot:group:")) return to.slice(13);
  // "woabot:{id}" → id
  if (to.startsWith("woabot:")) return to.slice(7);
  // 直接是 chat_id
  return to;
}

/**
 * 格式化为 Lark post content（rich text markdown）
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
