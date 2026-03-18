#!/bin/bash

# WoA Bot 一键更新并启动脚本
# 版本: 3.0 (WoA Bot 版)
#
# 将 woabot 插件安装到 openclaw 并配置 WoA Bot 通道。
# WoA Bot 通过 @larksuiteoapi/node-sdk 连接到 server 的
# /open-apis/* 兼容接口，由 server 桥接到 WPS 开放平台。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 解析命令行参数
APPID=""
SECRET=""
DOMAIN=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --appid)
            APPID="$2"
            shift 2
            ;;
        --secret)
            SECRET="$2"
            shift 2
            ;;
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        -h|--help)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --appid <appid>       WoA Bot AppID (即 WPS_APP_ID)"
            echo "  --secret <secret>     WoA Bot AppSecret (即 WPS_APP_SECRET)"
            echo "  --domain <url>        Server 地址 (默认: http://127.0.0.1:10086)"
            echo "  -h, --help            显示帮助信息"
            echo ""
            echo "也可以通过环境变量设置:"
            echo "  WOABOT_APP_ID         WoA Bot AppID"
            echo "  WOABOT_APP_SECRET     WoA Bot AppSecret"
            echo "  WOA_SERVER_URL        Server 地址"
            echo ""
            echo "不带参数时，将使用已有配置直接启动。"
            exit 0
            ;;
        *)
            echo "未知选项: $1"
            echo "使用 --help 查看帮助信息"
            exit 1
            ;;
    esac
done

# 使用命令行参数或环境变量
APPID="${APPID:-$WOABOT_APP_ID}"
SECRET="${SECRET:-$WOABOT_APP_SECRET}"
DOMAIN="${DOMAIN:-$WOA_SERVER_URL}"

echo "========================================="
echo "  WoA Bot 一键更新启动脚本"
echo "========================================="

# 1. 备份已有 woabot 通道配置，防止升级过程丢失
echo ""
echo "[1/5] 备份已有配置..."
SAVED_WOABOT_CONFIG=""
for APP_NAME in openclaw clawdbot moltbot; do
    CONFIG_FILE="$HOME/.$APP_NAME/$APP_NAME.json"
    if [ -f "$CONFIG_FILE" ]; then
        SAVED_WOABOT_CONFIG=$(node -e "
            const cfg = JSON.parse(require('fs').readFileSync('$CONFIG_FILE', 'utf8'));
            const ch = cfg.channels && cfg.channels.woabot;
            if (!ch) process.exit(0);
            const out = {};
            if (ch.appId) out.appId = ch.appId;
            if (ch.appSecret) out.appSecret = ch.appSecret;
            if (ch.domain) out.domain = ch.domain;
            if (Object.keys(out).length > 0) process.stdout.write(JSON.stringify(out));
        " 2>/dev/null || true)
        if [ -n "$SAVED_WOABOT_CONFIG" ]; then
            echo "已备份 woabot 通道配置"
            break
        fi
    fi
done

# 2. 移除老版本
echo ""
echo "[2/5] 移除老版本..."
if [ -f "./scripts/upgrade.sh" ]; then
    bash ./scripts/upgrade.sh
else
    echo "警告: upgrade.sh 不存在，跳过移除步骤"
fi

# 3. 安装当前版本
echo ""
echo "[3/5] 安装当前版本..."

echo "检查当前目录: $(pwd)"
echo "检查openclaw版本: $(openclaw --version 2>/dev/null || echo 'openclaw not found')"

echo "开始安装插件..."
INSTALL_LOG="/tmp/openclaw-install-$(date +%s).log"

echo "安装日志文件: $INSTALL_LOG"

# 尝试安装并捕获详细输出
if ! openclaw plugins install . 2>&1 | tee "$INSTALL_LOG"; then
    echo ""
    echo "❌ 插件安装失败！"
    echo "========================================="
    echo "故障排查信息:"
    echo "========================================="
    echo "1. 检查日志文件: $INSTALL_LOG"
    echo "2. 常见原因:"
    echo "   - 网络问题: curl -I https://registry.npmjs.org/"
    echo "   - 权限问题: ls -la ~/.openclaw/ 2>/dev/null"
    echo "   - npm配置: npm config get registry"
    echo ""
    echo "3. 错误摘要:"
    tail -20 "$INSTALL_LOG" | grep -i -E "(error|fail|warn)" || true
    echo ""
    echo "4. 可选解决方案:"
    echo "   a. 更换npm镜像: npm config set registry https://registry.npmmirror.com/"
    echo "   b. 清理缓存: npm cache clean --force"
    echo "   c. 手动安装: cd $(pwd) && npm install --verbose"
    echo ""

    read -p "是否继续配置其他步骤? (y/N): " continue_choice
    case "$continue_choice" in
        [Yy]* )
            echo "继续执行后续配置步骤..."
            ;;
        * )
            echo "安装失败，脚本退出。"
            exit 1
            ;;
    esac
else
    echo ""
    echo "✅ 插件安装成功！"
fi

# 4. 配置 WoA Bot 通道
echo ""
echo "[4/5] 配置 WoA Bot 通道..."

configure_woabot() {
    local app_id="$1"
    local app_secret="$2"
    local domain="$3"

    # 写入 woabot 通道配置到 openclaw 配置文件
    for APP_NAME in openclaw clawdbot moltbot; do
        CONFIG_FILE="$HOME/.$APP_NAME/$APP_NAME.json"
        if [ -f "$CONFIG_FILE" ]; then
            node -e "
                const fs = require('fs');
                const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf-8'));
                if (!cfg.channels) cfg.channels = {};
                if (!cfg.channels.woabot) cfg.channels.woabot = {};
                const ch = cfg.channels.woabot;
                ch.enabled = true;
                if ('$app_id') ch.appId = '$app_id';
                if ('$app_secret') ch.appSecret = '$app_secret';
                if ('$domain') ch.domain = '$domain';
                ch.connectionMode = 'websocket';
                fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 4) + '\n');
            " 2>&1 && echo "✅ 已写入 $CONFIG_FILE" || echo "⚠️  写入 $CONFIG_FILE 失败"
            return 0
        fi
    done
    echo "⚠️  未找到 openclaw 配置文件"
    return 1
}

if [ -n "$APPID" ] && [ -n "$SECRET" ]; then
    echo "使用提供的 AppID 和 AppSecret 配置..."
    configure_woabot "$APPID" "$SECRET" "${DOMAIN:-http://127.0.0.1:10086}"
elif [ -n "$SAVED_WOABOT_CONFIG" ]; then
    echo "未提供 AppID/AppSecret，使用备份配置恢复..."
    _saved_appid=$(echo "$SAVED_WOABOT_CONFIG" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.appId||'')" 2>/dev/null || true)
    _saved_secret=$(echo "$SAVED_WOABOT_CONFIG" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.appSecret||'')" 2>/dev/null || true)
    _saved_domain=$(echo "$SAVED_WOABOT_CONFIG" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.domain||'')" 2>/dev/null || true)
    if [ -n "$_saved_appid" ]; then
        configure_woabot "$_saved_appid" "$_saved_secret" "${DOMAIN:-$_saved_domain}"
        echo "✅ 已从备份恢复 woabot 通道配置"
    else
        echo "备份配置不完整，使用已有配置"
    fi
else
    echo "未提供 AppID/AppSecret，使用已有配置"
fi

# 5. 启动 openclaw
echo ""
echo "[5/5] 启动 openclaw..."
echo "========================================="

echo "OpenClaw版本: $(openclaw --version 2>/dev/null || echo '未知')"
echo ""
echo "请选择启动方式:"
echo ""
echo "  1) 后台重启 (推荐)"
echo "     重启后台服务，自动跟踪日志输出"
echo ""
echo "  2) 不启动"
echo "     插件已更新完毕，稍后自己手动启动"
echo ""
read -p "请输入选择 [1/2] (默认 1): " start_choice
start_choice="${start_choice:-1}"

case "$start_choice" in
    1)
        echo ""
        echo "正在后台重启 OpenClaw 网关服务..."
        if openclaw gateway restart 2>&1; then
            echo ""
            echo "✅ OpenClaw 网关已在后台重启"
            echo ""
            echo "等待 gateway 就绪..."
            echo "========================================="
            _port_ready=0
            for i in $(seq 1 30); do
                if lsof -i :18789 -sTCP:LISTEN >/dev/null 2>&1; then
                    _port_ready=1
                    break
                fi
                printf "\r  等待端口 18789 就绪... (%d/30)" "$i"
                sleep 2
            done
            echo ""

            if [ "$_port_ready" -eq 0 ]; then
                echo "⚠️  等待超时，gateway 可能仍在启动中"
                echo "请手动检查: openclaw doctor"
                echo "或查看日志: tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log"
            else
                echo "✅ Gateway 端口已就绪"
                echo ""
                echo "等待插件加载稳定..."
                sleep 8
                echo ""
                echo "正在跟踪日志输出（按 Ctrl+C 停止查看，不影响后台服务）..."
                echo "========================================="
                _retries=0
                while ! openclaw logs --follow 2>&1; do
                    _retries=$((_retries + 1))
                    if [ $_retries -ge 5 ]; then
                        echo ""
                        echo "⚠️  无法连接日志流，请手动执行: openclaw logs --follow"
                        echo "或直接查看日志文件: tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log"
                        break
                    fi
                    echo "等待日志流就绪... (${_retries}/5)"
                    sleep 3
                done
            fi
        else
            echo ""
            echo "⚠️  后台重启失败，可能服务未安装"
            echo "尝试: openclaw gateway install && openclaw gateway start"
        fi
        ;;
    2)
        echo ""
        echo "✅ 插件更新完毕，未启动服务"
        echo ""
        echo "后续可手动启动:"
        echo "  openclaw gateway restart    # 重启后台服务"
        echo "  openclaw logs --follow      # 跟踪日志"
        ;;
    *)
        echo "无效选择，跳过启动"
        ;;
esac

echo "========================================="
