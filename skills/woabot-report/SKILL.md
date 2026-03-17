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

## How It Works

1. Reads the list of **enabled** group chats from the database (`tb_wps_group` where `enabled=1`)
2. For each group, fetches messages within the selected time period via WPS OpenAPI
3. Filters to human user messages (excludes bots)
4. Groups results by sender, with person name resolved from `tb_wps_chat_member`
5. Optionally filters by `person` name (fuzzy match)

## Response Format

Returns results grouped by person:

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
