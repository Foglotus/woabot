import * as lark from "@larksuiteoapi/node-sdk";
import type { ResolvedWoaBotAccount } from "./types.js";

const clientCache = new Map<string, lark.Client>();

/**
 * 获取或创建 Lark Client 实例（带缓存）
 * Client 用于调用 Lark Open API（实际指向 server 的 /open-apis/*）
 */
export function getLarkClient(account: ResolvedWoaBotAccount): lark.Client {
  const cacheKey = `${account.accountId}:${account.appId}`;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new lark.Client({
      appId: account.appId,
      appSecret: account.appSecret,
      domain: account.domain,
    });
    clientCache.set(cacheKey, client);
  }
  return client;
}

/**
 * 清除某个账户的客户端缓存
 */
export function clearClientCache(accountId?: string): void {
  if (accountId) {
    for (const [key] of clientCache) {
      if (key.startsWith(`${accountId}:`)) {
        clientCache.delete(key);
      }
    }
  } else {
    clientCache.clear();
  }
}
