#!/bin/bash

# WoA Bot 拉取最新 npm 包并更新脚本
# 从 npm 下载 @sliverp/woabot@latest，解压覆盖本地源码，重新安装插件并重启
# 兼容 clawdbot / openclaw / moltbot
#
# 用法:
#   ./scripts/pull-latest.sh                  # 更新到最新版
#   ./scripts/pull-latest.sh @sliverp/woabot@2.0.1   # 更新到指定版本
#   ./scripts/pull-latest.sh --force          # 跳过交互，强制重新安装
#   ./scripts/pull-latest.sh --force @sliverp/woabot@2.0.1

set -e

# ============================================================
# 参数解析
# ============================================================
FORCE=false
PKG_NAME="@sliverp/woabot"
PKG_SPEC=""

for arg in "$@"; do
    case "$arg" in
        -f|--force) FORCE=true ;;
        *)          PKG_SPEC="$arg" ;;
    esac
done
PKG_SPEC="${PKG_SPEC:-${PKG_NAME}@latest}"

# ============================================================
# 定位项目目录（兼容从任意位置执行）
# ============================================================
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 如果脚本在 scripts/ 子目录里，往上一级就是项目根目录
if [ "$(basename "$SCRIPT_DIR")" = "scripts" ]; then
    PROJ_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
else
    PROJ_DIR="$SCRIPT_DIR"
fi
cd "$PROJ_DIR"

# ============================================================
# 前置依赖检查
# ============================================================
check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        echo "❌ 缺少必要命令: $1"
        echo "   $2"
        exit 1
    fi
}

check_cmd node  "请先安装 Node.js: https://nodejs.org/ 或 brew install node"
check_cmd npm   "npm 通常随 Node.js 一起安装"
check_cmd tar   "系统缺少 tar 命令"

echo "========================================="
echo "  WoA Bot 拉取最新版本并更新"
echo "========================================="
echo ""
echo "系统信息:"
echo "  OS    $(uname -s) $(uname -r 2>/dev/null | cut -d- -f1)"
echo "  Node  $(node -v 2>/dev/null)"
echo "  npm   $(npm -v 2>/dev/null)"

# ============================================================
# 0. 检测 openclaw / clawdbot / moltbot
# ============================================================
CMD=""
for name in openclaw clawdbot moltbot; do
    if command -v "$name" &>/dev/null; then
        CMD="$name"
        break
    fi
done
if [ -z "$CMD" ]; then
    echo ""
    echo "❌ 未找到 openclaw / clawdbot / moltbot 命令"
    echo "   请先安装其中之一"
    exit 1
fi
echo "  CLI   $CMD ($($CMD --version 2>/dev/null || echo '未知版本'))"

# ============================================================
# 1. 获取当前本地版本
# ============================================================
LOCAL_VER=""
if [ -f "$PROJ_DIR/package.json" ]; then
    LOCAL_VER=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PROJ_DIR/package.json','utf8')).version||'')" 2>/dev/null || true)
fi
echo ""
echo "[1/5] 当前本地版本: ${LOCAL_VER:-未知}"

# ============================================================
# 2. 查询 npm 远程版本
# ============================================================
echo ""
echo "[2/5] 查询 npm 版本..."

# 如果指定了具体版本号，直接从 PKG_SPEC 提取；否则查询 latest
if echo "$PKG_SPEC" | grep -qE '@[0-9]+\.[0-9]+'; then
    REMOTE_VER=$(echo "$PKG_SPEC" | sed 's/.*@//')
else
    REMOTE_VER=$(npm view "$PKG_NAME" version 2>/dev/null || echo "")
fi

if [ -z "$REMOTE_VER" ]; then
    echo "❌ 无法查询 $PKG_NAME 的版本，请检查网络"
    echo "   当前 npm 源: $(npm config get registry 2>/dev/null)"
    echo ""
    echo "   可尝试切换镜像源:"
    echo "   npm config set registry https://registry.npmmirror.com/"
    exit 1
fi
echo "目标版本: ${REMOTE_VER}"

if [ "$LOCAL_VER" = "$REMOTE_VER" ]; then
    echo ""
    echo "✅ 本地版本已是最新 ($LOCAL_VER)"
    if [ "$FORCE" = true ]; then
        echo "已指定 --force，继续重新安装..."
    else
        printf "是否强制重新安装? (y/N): "
        read -r force_choice </dev/tty 2>/dev/null || force_choice="N"
        case "$force_choice" in
            [Yy]* ) echo "强制重新安装..." ;;
            * ) echo "跳过更新。"; exit 0 ;;
        esac
    fi
fi

# ============================================================
# 3. 备份通道配置
# ============================================================
echo ""
echo "[3/5] 备份已有通道配置..."

SAVED_WOABOT_CONFIG=""

for APP_NAME in openclaw clawdbot moltbot; do
    CONFIG_FILE="$HOME/.$APP_NAME/$APP_NAME.json"
    [ -f "$CONFIG_FILE" ] || continue

    if [ -z "$SAVED_WOABOT_CONFIG" ]; then
        SAVED_WOABOT_CONFIG=$(node -e "
            const cfg = JSON.parse(require('fs').readFileSync('$CONFIG_FILE', 'utf8'));
            const ch = cfg.channels && cfg.channels.woabot;
            if (ch) process.stdout.write(JSON.stringify(ch));
        " 2>/dev/null || true)
    fi

    [ -n "$SAVED_WOABOT_CONFIG" ] && break
done

if [ -n "$SAVED_WOABOT_CONFIG" ]; then
    echo "已备份 woabot 通道配置"
else
    echo "未找到已有通道配置（首次安装或已清理）"
fi

# ============================================================
# 4. 下载并解压最新包
# ============================================================
echo ""
echo "[4/5] 下载 $PKG_SPEC 并更新本地文件..."

TMP_DIR="$PROJ_DIR/.woabot-update-tmp"

# 清理函数：删除临时文件夹
cleanup() {
    if [ -d "$TMP_DIR" ]; then
        echo "清理临时文件夹: $TMP_DIR"
        rm -rf "$TMP_DIR"
    fi
}
trap cleanup EXIT INT TERM

[ -d "$TMP_DIR" ] && rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

echo "下载中..."
TARBALL=$(cd "$TMP_DIR" && npm pack "$PKG_SPEC" 2>/dev/null)
if [ -z "$TARBALL" ] || [ ! -f "$TMP_DIR/$TARBALL" ]; then
    echo "❌ 下载失败"
    echo "   请检查网络连接，或尝试:"
    echo "   npm pack $PKG_SPEC"
    exit 1
fi
echo "已下载: $TARBALL"

echo "解压中..."
tar xzf "$TMP_DIR/$TARBALL" -C "$TMP_DIR"

PACK_DIR="$TMP_DIR/package"
if [ ! -d "$PACK_DIR" ]; then
    echo "❌ 解压后未找到 package 目录"
    exit 1
fi

NEW_VER=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PACK_DIR/package.json','utf8')).version||'')" 2>/dev/null || echo "$REMOTE_VER")
echo "将更新到版本: $NEW_VER"

# 同步文件
echo "同步文件到本地..."

(
    cd "$PACK_DIR"
    find . -type f | while IFS= read -r f; do
        case "$f" in
            ./.DS_Store|./.git/*|./node_modules/*) continue ;;
        esac
        dir=$(dirname "$f")
        mkdir -p "$PROJ_DIR/$dir"
        cp -f "$f" "$PROJ_DIR/$f"
    done
)

echo "✅ 文件已更新到 $NEW_VER"

echo "删除临时文件夹..."
rm -rf "$TMP_DIR"

echo "安装依赖..."
cd "$PROJ_DIR"
npm install --omit=dev 2>&1 | tail -5

# ============================================================
# 5. 卸载旧插件、安装新插件、恢复配置、重启
# ============================================================
echo ""
echo "[5/5] 重新安装插件并重启..."

# 清理旧版本（配置 + 扩展目录）
if [ -f "$PROJ_DIR/scripts/upgrade.sh" ]; then
    echo "清理旧版本插件..."
    bash "$PROJ_DIR/scripts/upgrade.sh"
fi

# 强制删除已有扩展目录，防止 "plugin already exists" 错误
for APP_NAME in openclaw clawdbot moltbot; do
    for EXT_NAME in woabot qqbot; do
        EXT_DIR="$HOME/.$APP_NAME/extensions/$EXT_NAME"
        if [ -d "$EXT_DIR" ]; then
            echo "删除已有扩展目录: $EXT_DIR"
            rm -rf "$EXT_DIR"
        fi
    done
done

# 安装插件
echo ""
echo "安装新版本插件..."
if ! $CMD plugins install . 2>&1; then
    echo "❌ 插件安装失败，请检查上方错误信息"
    exit 1
fi
echo "✅ 插件安装成功"

# 恢复通道配置
if [ -n "$SAVED_WOABOT_CONFIG" ]; then
    echo ""
    echo "恢复 woabot 通道配置..."
    APP_CONFIG="$HOME/.$CMD/$CMD.json"
    if [ -f "$APP_CONFIG" ]; then
        node -e "
          var fs = require('fs');
          var cfg = JSON.parse(fs.readFileSync('$APP_CONFIG', 'utf-8'));
          cfg.channels = cfg.channels || {};
          cfg.channels.woabot = $SAVED_WOABOT_CONFIG;
          fs.writeFileSync('$APP_CONFIG', JSON.stringify(cfg, null, 4) + '\n');
        " 2>/dev/null && echo "✅ 通道配置已恢复" || echo "⚠️  通道配置恢复失败"
    fi
fi

# 重启网关
echo ""
echo "重启网关服务..."

$CMD gateway stop 2>/dev/null || true
sleep 1

# 如果端口还被占用，强制杀进程
PORT_PID=$(lsof -ti:18789 2>/dev/null || true)
if [ -n "$PORT_PID" ]; then
    echo "端口 18789 仍被占用 (pid: $PORT_PID)，强制终止..."
    kill -9 $PORT_PID 2>/dev/null || true
    sleep 1
fi

# 卸载 launchd 服务（防止自动拉起旧进程）
for SVC_NAME in ai.openclaw.gateway ai.clawdbot.gateway ai.moltbot.gateway; do
    launchctl bootout "gui/$(id -u)/$SVC_NAME" 2>/dev/null || true
done

# 启动新的 gateway
if $CMD gateway 2>&1; then
    echo ""
    echo "✅ 网关已启动"
    echo "查看日志: $CMD gateway log"
else
    echo ""
    echo "⚠️  网关启动失败，尝试手动启动:"
    echo "  $CMD gateway install && $CMD gateway"
fi

echo ""
echo "========================================="
echo "  ✅ WoA Bot 已从 ${LOCAL_VER:-未知} 更新到 ${NEW_VER}"
echo "========================================="
echo ""
echo "常用命令:"
echo "  $CMD gateway log          # 查看日志"
echo "  $CMD gateway restart      # 重启服务"
echo "  $CMD plugins list         # 查看插件列表"
echo "========================================="
