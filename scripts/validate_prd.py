#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PRD 查看器一致性校验脚本（纯标准库，无第三方依赖）

校验三方一致：
  1. 原型 HTML/JS 中的编号徽章      data-prd="XX-NN"
  2. 查看器数据 PRD_SECTIONS 章节   id: 'XX-NN'
  3. PRD.md 文档章节标题            ## XX-NN ...

用法：
  python validate_prd.py <原型目录>

输出分级：
  [错误] 必须修复（徽章无章节 / PRD.md 缺章 / 重复编号）
  [警告] 逐条确认合理性（章节无徽章 / 编号断号 / 正文仍为旧版 HTML）
退出码：0 = 无错误（允许警告）；1 = 存在错误
"""

import re
import sys
from pathlib import Path

BADGE_RE = re.compile(r'data-prd="([A-Z]{2,4}-\d{2})"')
SECTIONS_BLOCK_RE = re.compile(r'PRD_SECTIONS\s*=\s*\[(.*?)\];', re.S)
SECTION_ID_RE = re.compile(r"id:\s*'([A-Z]{2,4}-\d{2})'")
MD_HEAD_RE = re.compile(r'^##\s+([A-Z]{2,4}-\d{2})[\s　]', re.M)
# 章节正文应为 Markdown；命中说明是旧版 HTML body（仅兼容直出）
HTML_BODY_RE = re.compile(r'<(p|table|ul|ol|div|section|blockquote|h[1-6])\b', re.I)

CODE_EXTS = {'.html', '.htm', '.js', '.vue', '.jsx', '.tsx'}


def find_code_files(root: Path):
    return [p for p in root.rglob('*')
            if p.suffix.lower() in CODE_EXTS
            and 'node_modules' not in p.parts and '.git' not in p.parts]


def collect_badges(files):
    """徽章 -> 出现位置列表"""
    found = {}
    for p in files:
        try:
            text = p.read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        for m in BADGE_RE.finditer(text):
            found.setdefault(m.group(1), []).append(str(p))
    return found


def collect_sections(files):
    """PRD_SECTIONS 中的章节 id -> 所在文件"""
    found = {}
    for p in files:
        try:
            text = p.read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        for block in SECTIONS_BLOCK_RE.finditer(text):
            for m in SECTION_ID_RE.finditer(block.group(1)):
                found.setdefault(m.group(1), []).append(str(p))
    return found


def collect_prd_md(root: Path):
    """PRD.md 章节 -> 所在文件；返回 (sections, md_files)"""
    found = {}
    md_files = [p for p in root.rglob('*.md')
                if 'prd' in p.name.lower() and 'node_modules' not in p.parts]
    for p in md_files:
        try:
            text = p.read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        for m in MD_HEAD_RE.finditer(text):
            found.setdefault(m.group(1), []).append(str(p))
    return found, md_files


def check_gaps(ids, label, errors):
    """同一前缀内编号断号检测（仅警告）"""
    by_prefix = {}
    for sid in ids:
        prefix, num = sid.rsplit('-', 1)
        by_prefix.setdefault(prefix, set()).add(int(num))
    for prefix, nums in sorted(by_prefix.items()):
        if not nums:
            continue
        full = set(range(min(nums), max(nums) + 1))
        missing = sorted(full - nums)
        for n in missing:
            errors.append(('警告', f'{label}：编号断号 {prefix}-{n:02d}（确认是否为已删除模块）'))


def main():
    if len(sys.argv) < 2:
        print('用法: python validate_prd.py <原型目录>')
        return 1
    root = Path(sys.argv[1])
    if not root.is_dir():
        print(f'目录不存在: {root}')
        return 1
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    files = find_code_files(root)
    badges = collect_badges(files)
    sections = collect_sections(files)
    md_secs, md_files = collect_prd_md(root)

    issues = []

    # 重复检测：同一 id 在多文件出现属正常（如独立分享版），仅同文件重复视为问题
    # 此处聚焦跨源一致性，重复检测针对 PRD_SECTIONS 同文件内重复
    for p in files:
        try:
            text = p.read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        for block in SECTIONS_BLOCK_RE.finditer(text):
            ids = SECTION_ID_RE.findall(block.group(1))
            dup = sorted({i for i in ids if ids.count(i) > 1})
            for d in dup:
                issues.append(('错误', f'PRD_SECTIONS 章节重复: {d}（{p}）'))
            if HTML_BODY_RE.search(block.group(1)):
                issues.append(('警告', f'PRD_SECTIONS 正文含 HTML 标签（{p}）：仅按旧版兼容直出，建议改为 Markdown'))

    # 徽章 -> 章节
    for bid, locs in sorted(badges.items()):
        if bid not in sections:
            issues.append(('错误', f'徽章 {bid} 无对应 PRD_SECTIONS 章节（出现于 {locs[0]} 等 {len(locs)} 处）'))
    # 章节 -> 徽章
    for sid in sorted(sections):
        if sid not in badges:
            issues.append(('警告', f'章节 {sid} 无页面徽章（弹窗子章节/全局框架类可豁免，需人工确认）'))
    # 章节 -> PRD.md
    if not md_files:
        issues.append(('警告', '目录内未找到 *PRD*.md 文档，跳过文档章节校验'))
    else:
        for sid in sorted(sections):
            if sid not in md_secs:
                issues.append(('错误', f'章节 {sid} 在 PRD.md 中缺失（文档与查看器不同源）'))
        for mid in sorted(md_secs):
            if mid not in sections:
                issues.append(('警告', f'PRD.md 章节 {mid} 未接入查看器数据（确认是否为子章节或遗漏）'))

    check_gaps(list(sections.keys()), 'PRD_SECTIONS', issues)
    check_gaps(list(badges.keys()), '页面徽章', issues)

    print(f'扫描目录: {root}')
    print(f'代码文件: {len(files)} 个 | 徽章: {len(badges)} 种 | 查看器章节: {len(sections)} 个 | PRD.md 章节: {len(md_secs)} 个')
    print('-' * 60)
    errs = [m for lv, m in issues if lv == '错误']
    warns = [m for lv, m in issues if lv == '警告']
    for lv, msg in issues:
        print(f'[{lv}] {msg}')
    print('-' * 60)
    print(f'结果: {len(errs)} 个错误, {len(warns)} 个警告')
    if not errs and not warns:
        print('三方一致，校验通过。')
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main())
