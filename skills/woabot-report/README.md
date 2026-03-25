# WOA 日报技能说明

本目录采用双层结构：

- `SKILL.md`：负责触发、意图映射、稳定调用流程和强约束
- `README.md`：负责参数、接口、样例、返回结构和识别规则

如果目标是让代理稳定调用 API，应优先遵循 `SKILL.md` 的流程约束，再参考本文档补充参数细节。

## 工具说明

### 1. `woa_daily`

查询日报。

参数：

- `period`：必填，时间范围
- `person`：可选，人名模糊匹配；不传表示查询所有人

`period` 取值映射：

- `today`：今天
- `this_week`：本周
- `last_week`：上周
- `this_month`：本月
- `last_month`：上月

最小调用：

```json
{ "period": "today" }
```

按人查询：

```json
{ "period": "this_week", "person": "张三" }
```

接口：

```text
GET {WOA_SERVER_URL}/api/daily?period=<period>&person=<person>
```

请求示例：

```bash
curl http://127.0.0.1:10086/api/daily?period=today
curl http://127.0.0.1:10086/api/daily?period=this_week&person=张三
```

响应示例：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "period": "today",
    "start_time": 1741737600,
    "end_time": 1741823999,
    "groups_scanned": 3,
    "items": []
  }
}
```

### 2. `woa_daily_members`

查询应写日报的成员列表。

参数：无。

最小调用：

```json
{}
```

接口：

```text
GET {WOA_SERVER_URL}/api/daily/members
```

响应示例：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "total": 5,
    "items": [
      {
        "member_id": "uid_xxx",
        "nickname": "张三",
        "chat_id": "chat_xxx",
        "company_id": "company_xxx"
      }
    ]
  }
}
```

### 3. `woa_daily_remind`

批量提醒未提交日报的成员。

参数：

- `member_ids`：必填，成员 ID 数组
- `message`：可选，自定义提醒文案；默认值为“请记得提交今天的日报。”

关键约束：

- 必须先通过 `woa_daily_members` 获取 `member_id`
- 必须一次性传入全部 `member_ids`
- `message` 只能是纯文本，不要写 `@`，不要写人名
- 服务端会自动按群分组并完成 @提醒

默认调用：

```json
{ "member_ids": ["uid_001", "uid_002", "uid_003"] }
```

自定义文案：

```json
{ "member_ids": ["uid_001", "uid_002"], "message": "请尽快提交今天的日报" }
```

接口：

```text
POST {WOA_SERVER_URL}/api/daily/remind
Content-Type: application/json

{ "member_ids": ["uid_001", "uid_002"], "message": "<optional custom text>" }
```

请求示例：

```bash
curl -X POST http://127.0.0.1:10086/api/daily/remind \
  -H "Content-Type: application/json" \
  -d '{"member_ids": ["uid_001", "uid_002", "uid_003"]}'

curl -X POST http://127.0.0.1:10086/api/daily/remind \
  -H "Content-Type: application/json" \
  -d '{"member_ids": ["uid_001"], "message": "请提交今天的日报"}'
```

响应示例：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "sent": [
      {
        "chat_id": "chat_xxx",
        "message_id": "msg_xxx",
        "members": ["uid_001", "uid_002"]
      }
    ],
    "skipped": ["uid_999"],
    "errors": []
  }
}
```

错误示例：

```json
{
  "code": 404,
  "msg": "no valid enabled members found"
}
```

## 提醒脚本的稳定执行方式

提醒未写日报的人时，推荐始终按下面流程执行：

1. 调用 `woa_daily_members` 获取全量候选成员
2. 调用 `woa_daily` 且固定使用 `period=today`
3. 用成员列表减去已提交日报的人
4. 若差集为空，则结束，不调用提醒接口
5. 若差集非空，则一次性调用 `woa_daily_remind`

这是最稳的调用路径，避免漏提醒、重复提醒或因为昵称匹配错误导致提醒失败。

## 日报识别规则

服务端会根据消息内容判断是否为日报。通常满足以下任一条件即可视为日报：

- 日期 + 工作关键词
- 工作关键词 + 编号列表

模式示例：

| 类型 | 示例 |
| ---- | ---- |
| 日期 | `2026.3.18`、`2026/3/18`、`2026-03-18`、`3月18日` |
| 关键词 | `昨天主要做了`、`今天主要做`、`昨日完成`、`今日计划`、`工作总结`、`工作汇报`、`日报` |
| 编号列表 | `1、...`、`2、...`、`1. ...`、`1）...` |

日报示例：

```text
2026.3.18
昨天主要做了：
1、徐州 xc 太极项目，反馈银河麒麟 X86 环境 WPS 卡顿，已提供最新安装包待反馈
2、苏州市公安局计划全市推广 AI，目前正在确认使用人数
今天主要做：
1、徐州市大数据局文档中台客户反馈最近预览慢问题处理
```

## 服务端处理逻辑

日报查询通常按以下逻辑执行：

1. 读取数据库中启用的群聊
2. 在指定时间范围内拉取群消息
3. 过滤机器人消息，仅保留真人消息
4. 过滤无法解析昵称的发送者
5. 识别日报格式，仅保留日报消息
6. 按发送人聚合结果
7. 如指定 `person`，再做模糊匹配过滤

## 返回结构

日报查询返回：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
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
}
```

## 配置

```yaml
channels:
  woa:
    tools:
      daily: true
      daily_members: true
      daily_remind: true
```

## 环境变量

- `WOA_SERVER_URL`：服务地址，默认 `http://127.0.0.1:10086`

补充参考文档：

- `references/intent-routing.md`：用户请求到工具或流程的显式路由表
- `references/remind-workflow.md`：提醒日报的标准执行路径
- `references/query-examples.md`：高频查询场景和推荐调用
- `references/response-templates.md`：查询和提醒结果的标准回复模板
- `references/edge-cases.md`：缺参、无结果、模糊匹配等边界场景处理

以上参考文档用于约束固定流程、固定回复和边界场景处理。
