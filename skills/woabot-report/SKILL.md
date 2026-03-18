---
name: woabot-report
description: |
  WOA daily report retrieval. Activate when user mentions daily report, 日报, work summary, or today's updates.
---

# WOA Daily Report Tool

Single tool `woa_daily` for fetching daily reports from enabled WOA group chats.

## Parameters

- **period** (required): Time range to query
  - `today` — 今天
  - `this_week` — 本周
  - `last_week` — 上周
  - `this_month` — 本月
  - `last_month` — 上月

- **person** (optional): Person name (fuzzy match). Omit to return all people.

## Usage Examples

### Get today's reports for everyone

```json
{ "period": "today" }
```

### Get this week's reports for a specific person

```json
{ "period": "this_week", "person": "张三" }
```

### Get last month's reports

```json
{ "period": "last_month" }
```

## API

```
GET {WOA_SERVER_URL}/api/daily?period=<period>&person=<person>
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `period` | string | 是 | 时间段：`today` / `this_week` / `last_week` / `this_month` / `last_month` |
| `person` | string | 否 | 人名（模糊匹配），不传返回所有人 |

### 请求示例

```bash
# 获取今天所有人的日报
curl http://127.0.0.1:10086/api/daily?period=today

# 获取本周张三的日报
curl http://127.0.0.1:10086/api/daily?period=this_week&person=张三
```

### 响应示例

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "period": "today",
    "start_time": 1741737600,
    "end_time": 1741823999,
    "groups_scanned": 3,
    "items": [...]
  }
}
```

## How It Works

1. Reads the list of **enabled** group chats from the database (`tb_wps_group` where `enabled=1`)
2. For each group, fetches messages within the selected time period via WPS OpenAPI
3. Filters to human user messages (excludes bots)
4. Filters out users whose name cannot be resolved from `tb_wps_chat_member` (no nickname → skip)
5. **Detects daily report format** — only messages matching the daily report template are kept (see below)
6. Groups results by sender, with person name resolved from `tb_wps_chat_member`
7. Optionally filters by `person` name (fuzzy match)

## Daily Report Detection

Messages are checked against the daily report format using code-level pattern matching. A message is considered a daily report when it satisfies **at least one** of these conditions:

- **(Date + Keyword)**: Contains a date line AND a work-related keyword
- **(Keyword + Numbered items)**: Contains a work-related keyword AND numbered list items

### Patterns

| Pattern | Examples |
|---------|----------|
| **Date** | `2026.3.18`, `2026/3/18`, `2026-03-18`, `3月18日` |
| **Keyword** | `昨天主要做了`, `今天主要做`, `昨日完成`, `今日计划`, `工作总结`, `工作汇报`, `日报` |
| **Numbered items** | `1、 ...`, `2、 ...`, `1. ...`, `1）...` |

### Example daily report

```
2026.3.18
昨天主要做了：
1、 徐州xc太极项目，反馈银河麒麟X86环境wps卡顿，已提供最新安装包待反馈
2、 苏州市公安局计划全市推广ai，目前正在确认使用人数
今天主要做：
1、 徐州市大数据局文档中台客户反馈最近预览慢问题处理
```

## Response Format

返回 `{ code: 0, msg: "ok", data: DailyResult }`，`data` 结构如下：

```json
{
  "period": "today",
  "start_time": 1741737600,
  "end_time": 1741823999,
  "groups_scanned": 3,
  "items": [
    {
      "person_id": "uid_xxx",
      "person_name": "张三",
      "messages": [
        {
          "message_id": "msg_xxx",
          "chat_id": "chat_xxx",
          "group_name": "项目日报群",
          "sender_id": "uid_xxx",
          "sender_name": "张三",
          "content": { "text": "今日完成..." },
          "type": "text",
          "time": 1741780000
        }
      ]
    }
  ]
}
```

## Configuration

```yaml
channels:
  woa:
    tools:
      daily: true # default: true
```

## Environment

- `WOA_SERVER_URL` — Server base URL (default: `http://127.0.0.1:10086`)
