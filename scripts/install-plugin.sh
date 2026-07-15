#!/bin/bash
#
# install-plugin.sh - 安装自定义 WebSocket 插件到 Android 项目
#
# 在 GitHub Actions 的 `npx cap sync` 之后运行，完成以下工作：
#   1. 创建目标目录并复制 CustomWebSocketPlugin.java
#   2. 修改 MainActivity（Java/Kotlin）注册插件
#   3. 确保 android/app/build.gradle 中有 OkHttp 依赖
#   4. 在 android/app/build.gradle 中添加签名配置（signingConfig）
#
# 用法:
#   bash scripts/install-plugin.sh
#
# 签名配置需要以下环境变量（由 GitHub Actions secrets 注入）：
#   KEYSTORE_PASSWORD  - keystore 密码
#   KEY_ALIAS          - key 别名
#   KEY_PASSWORD       - key 密码
#
# 如果环境变量未设置，则跳过签名配置步骤（适用于本地开发）。
#

set -e

# ============================================================
# 路径定义
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ANDROID_DIR="$PROJECT_ROOT/android"
APP_DIR="$ANDROID_DIR/app"
JAVA_BASE_DIR="$APP_DIR/src/main/java/com/sisi/expressiontrainer"
PLUGIN_SOURCE="$PROJECT_ROOT/android-plugin/CustomWebSocketPlugin.java"
GRADLE_FILE="$APP_DIR/build.gradle"

echo "=========================================="
echo "  安装自定义 WebSocket 插件"
echo "=========================================="
echo "项目根目录: $PROJECT_ROOT"
echo ""

# ============================================================
# 1. 创建目标目录并复制插件 Java 文件
# ============================================================

echo "[1/4] 复制 CustomWebSocketPlugin.java ..."

if [ ! -f "$PLUGIN_SOURCE" ]; then
    echo "  错误: 插件源文件不存在: $PLUGIN_SOURCE"
    exit 1
fi

mkdir -p "$JAVA_BASE_DIR"
cp "$PLUGIN_SOURCE" "$JAVA_BASE_DIR/CustomWebSocketPlugin.java"
echo "  已复制到: $JAVA_BASE_DIR/CustomWebSocketPlugin.java"

# ============================================================
# 2. 修改 MainActivity 注册插件
# ============================================================

echo ""
echo "[2/4] 注册插件到 MainActivity ..."

MAIN_ACTIVITY_JAVA="$JAVA_BASE_DIR/MainActivity.java"
MAIN_ACTIVITY_KT="$JAVA_BASE_DIR/MainActivity.kt"

# 生成 Java 版 MainActivity
write_java_mainactivity() {
    cat > "$MAIN_ACTIVITY_JAVA" << 'JAVA_EOF'
package com.sisi.expressiontrainer;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CustomWebSocketPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
JAVA_EOF
}

# 生成 Kotlin 版 MainActivity
write_kotlin_mainactivity() {
    cat > "$MAIN_ACTIVITY_KT" << 'KT_EOF'
package com.sisi.expressiontrainer

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(CustomWebSocketPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
KT_EOF
}

if [ -f "$MAIN_ACTIVITY_KT" ]; then
    # Kotlin 版 MainActivity
    echo "  检测到 Kotlin 版 MainActivity"
    write_kotlin_mainactivity
    echo "  已写入 MainActivity.kt（注册 CustomWebSocketPlugin）"
elif [ -f "$MAIN_ACTIVITY_JAVA" ]; then
    # Java 版 MainActivity
    echo "  检测到 Java 版 MainActivity"
    write_java_mainactivity
    echo "  已写入 MainActivity.java（注册 CustomWebSocketPlugin）"
else
    # 默认创建 Java 版
    echo "  未找到 MainActivity，创建 Java 版"
    write_java_mainactivity
    echo "  已创建 MainActivity.java（注册 CustomWebSocketPlugin）"
fi

# ============================================================
# 3. 确保 OkHttp 依赖
# ============================================================

echo ""
echo "[3/4] 检查 OkHttp 依赖 ..."

if [ ! -f "$GRADLE_FILE" ]; then
    echo "  错误: build.gradle 不存在: $GRADLE_FILE"
    exit 1
fi

if grep -q "okhttp3:okhttp" "$GRADLE_FILE"; then
    echo "  OkHttp 依赖已存在，跳过"
else
    echo "  添加 OkHttp 依赖到 build.gradle ..."
    # 在 dependencies 块中添加 okhttp 依赖
    sed -i '/^dependencies {/a\    implementation '"'"'com.squareup.okhttp3:okhttp:4.12.0'"'"'' "$GRADLE_FILE"
    echo "  已添加: implementation 'com.squareup.okhttp3:okhttp:4.12.0'"
fi

# ============================================================
# 4. 添加签名配置（signingConfig）
# ============================================================

echo ""
echo "[4/4] 配置签名 ..."

if [ -z "$KEYSTORE_PASSWORD" ]; then
    echo "  未设置 KEYSTORE_PASSWORD 环境变量，跳过签名配置"
    echo "  （本地开发可忽略，GitHub Actions 会自动注入）"
else
    echo "  使用 Python 脚本配置签名 ..."
    python3 "$SCRIPT_DIR/configure-signing.py" \
        "$GRADLE_FILE" \
        "$KEYSTORE_PASSWORD" \
        "$KEY_ALIAS" \
        "$KEY_PASSWORD"
    echo "  签名配置完成"
fi

# ============================================================
# 完成
# ============================================================

echo ""
echo "=========================================="
echo "  插件安装完成"
echo "=========================================="
echo ""
echo "已完成的操作:"
echo "  - CustomWebSocketPlugin.java 已复制到 Android 项目"
echo "  - MainActivity 已注册 CustomWebSocketPlugin"
echo "  - OkHttp 依赖已确认"
echo "  - 签名配置已处理"
echo ""
