#!/usr/bin/env python3
"""
configure-signing.py - 向 Android app/build.gradle 注入签名配置

用法:
    python3 configure-signing.py <gradle_file> <keystore_password> <key_alias> <key_password>

完成两件事:
    1. 在 android {} 块内、buildTypes {} 之前插入 signingConfigs { release { ... } }
    2. 在 buildTypes { release { ... } } 块内添加 signingConfig signingConfigs.release
"""

import re
import sys


def main():
    if len(sys.argv) != 5:
        print("用法: configure-signing.py <gradle_file> <store_password> <key_alias> <key_password>")
        sys.exit(1)

    gradle_file = sys.argv[1]
    store_password = sys.argv[2]
    key_alias = sys.argv[3]
    key_password = sys.argv[4]

    with open(gradle_file, "r", encoding="utf-8") as f:
        content = f.read()

    # ----------------------------------------------------------
    # 步骤 1: 添加 signingConfigs 块（如果不存在）
    # ----------------------------------------------------------
    if re.search(r"signingConfigs\s*\{", content):
        print("  [1/2] signingConfigs 已存在，跳过")
    else:
        signing_block = (
            "    signingConfigs {\n"
            "        release {\n"
            f'            storeFile file("release.keystore")\n'
            f'            storePassword "{store_password}"\n'
            f'            keyAlias "{key_alias}"\n'
            f'            keyPassword "{key_password}"\n'
            "        }\n"
            "    }\n"
        )
        # 在 buildTypes { 前面插入
        content = re.sub(
            r"(^[ \t]*buildTypes\s*\{)",
            signing_block + r"\1",
            content,
            count=1,
            flags=re.MULTILINE,
        )
        print("  [1/2] 已添加 signingConfigs.release 块")

    # ----------------------------------------------------------
    # 步骤 2: 在 release buildType 中添加 signingConfig
    # ----------------------------------------------------------
    # 匹配 buildTypes { ... release { ... } } 并在其中添加 signingConfig
    # 策略: 找到 buildTypes 块内的 release { 行，在其后添加 signingConfig

    # 先检查 release buildType 中是否已有 signingConfig
    # 用一个简单的方法: 找到 "release {" 在 buildTypes 之后的第一个出现
    lines = content.split("\n")
    build_types_depth = 0
    release_depth = 0
    in_build_types = False
    in_release = False
    has_signing_in_release = False
    release_insert_idx = -1

    for i, line in enumerate(lines):
        stripped = line.strip()

        # 检测进入 buildTypes {
        if re.match(r"^\s*buildTypes\s*\{", line):
            in_build_types = True
            build_types_depth = 1
            continue

        if in_build_types:
            # 统计大括号深度
            opens = line.count("{")
            closes = line.count("}")

            if in_release:
                # 检查是否已有 signingConfig
                if "signingConfig" in stripped:
                    has_signing_in_release = True
                # release 块结束
                if closes > 0 and build_types_depth - opens + closes <= 0:
                    in_release = False
                    in_build_types = False
                    build_types_depth = 0
                    continue
                build_types_depth += opens - closes
            else:
                # 检测进入 release {
                if re.match(r"^\s*release\s*\{", line):
                    in_release = True
                    release_insert_idx = i  # 在这行之后插入 signingConfig
                    build_types_depth += opens - closes
                else:
                    build_types_depth += opens - closes
                    if build_types_depth <= 0:
                        in_build_types = False

    if has_signing_in_release:
        print("  [2/2] release buildType 已有 signingConfig，跳过")
    elif release_insert_idx >= 0:
        # 获取 release { 行的缩进
        release_line = lines[release_insert_idx]
        # 缩进: release { 前面的空格 + 额外 4 个空格
        indent_match = re.match(r"^(\s*)", release_line)
        base_indent = indent_match.group(1) if indent_match else "        "
        inner_indent = base_indent + "    "

        signing_line = f"{inner_indent}signingConfig signingConfigs.release"

        lines.insert(release_insert_idx + 1, signing_line)
        content = "\n".join(lines)
        print("  [2/2] 已在 release buildType 中添加 signingConfig signingConfigs.release")
    else:
        print("  [2/2] 警告: 未找到 release buildType，请检查 build.gradle 格式")
        # 回退方案: 使用简单的正则替换
        content = re.sub(
            r"(buildTypes\s*\{\s*release\s*\{)",
            r"\1\n            signingConfig signingConfigs.release",
            content,
            count=1,
        )
        print("  [2/2] 回退方案: 已使用正则替换添加 signingConfig")

    # 写回文件
    with open(gradle_file, "w", encoding="utf-8") as f:
        f.write(content)

    print("  签名配置注入完成")


if __name__ == "__main__":
    main()
