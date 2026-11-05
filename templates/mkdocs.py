# -*- coding: utf-8 -*-
"""口播稿.md + 打点表.md + 独立字幕 .srt（字幕不烧录，后期配照片素材后再烧）。

按 gid 对齐，不靠行序 —— 预览里删掉某段之后，那一组的行会从 cuts.json 里消失，
用行序 zip 会整体错位；用 gid 取还能对上的组、跳过被删的组。
"""
import json

# ============================ 本集配置 ============================
NAME = "EP00-标题-口播动效版"
RAW  = 0.0        # 原片时长（秒）
SRC_NAME = "原片.mov"   # 只为文档里好看
TITLE = "EP00 标题"
# 校订后的口播文本：一组一句，顺序与 plan.py 的 GROUPS 一致
TEXT = [
]
# 术语校订表：| ASR 误识 | 校订 |
TERMS = [
]
# 清理清单：| 类型 | 内容 | 处理 |
CLEANUP = [
]
# 源片 vs 成片对照：| 剪掉的段 | 源时间码 | 为什么 |
CUTS_TABLE = [
]
# 表格后面的补充说明（markdown 原文，每行一条）
NOTES = [
]
# ================================================================

cuts   = json.load(open("cuts.json"))
design = json.load(open("design.json"))
BY_GID = {r["gid"]: r for r in cuts["rows"] if r.get("gid", -1) >= 0}
PAIRS = [(BY_GID[i], TEXT[i], design[i]) for i in range(len(design)) if i in BY_GID]
DEAD  = [i for i in range(len(design)) if i not in BY_GID]

def ts(sec):
    h = int(sec // 3600); m = int(sec % 3600 // 60); s = sec % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")

def wrap(txt, n=16):
    if len(txt) <= n: return [txt]
    parts = []; cur = ""
    for ch in txt:
        cur += ch
        if len(cur) >= n and ch in "，、。！？；：":
            parts.append(cur); cur = ""
    if cur: parts.append(cur)
    if len(parts) > 2:
        mid = len(parts) // 2 + 1
        parts = ["".join(parts[:mid]), "".join(parts[mid:])]
    return parts[:2]

srt = []
for i, (r, t, d) in enumerate(PAIRS, 1):
    srt.append(f"{i}\n{ts(r['out0'])} --> {ts(r['out1'])}\n" + "\n".join(wrap(t)) + "\n")
open(f"{NAME}.srt", "w").write("\n".join(srt))
print("srt", len(PAIRS), "条")

TOT = cuts["total"]
md = [f"# {TITLE} 口播稿（校订版）", "",
 f"- 成片时长 **{TOT:.2f}s**（{cuts['nframes']} 帧 @30fps，1080×1920）",
 f"- 原片 `{SRC_NAME}` {RAW:.2f}s → 剪掉 **{RAW-TOT:.2f}s（{(RAW-TOT)/RAW*100:.1f}%）",
 f"- 剪完 **{TOT:.2f}s**（≈{round(TOT)} 秒）", "",
 "## 清理清单", "| 类型 | 内容 | 处理 |", "|---|---|---|"]
md += [f"| {a} | {b} | {c} |" for a, b, c in CLEANUP]
md += ["", "## 逐句（成片时间码）", ""]
for i, (r, t, d) in enumerate(PAIRS, 1):
    md.append(f"{i:02d}. `{r['out0']:6.2f} – {r['out1']:6.2f}`　{t}")
if DEAD:
    md += ["", "> 预览里被删掉的组（原组号 %s）已从成片移除。" % ", ".join(f"{i+1:02d}" for i in DEAD)]
md += ["", "## 术语校订", "| ASR 误识 | 校订 |", "|---|---|"]
md += [f"| {a} | {b if '**' in b else '**' + b + '**'} |" for a, b in TERMS]
if NOTES:
    md += [""] + NOTES + [""]
md += ["## 源片 vs 成片对照", "| 剪掉的段 | 源时间码 | 为什么 |", "|---|---|---|"]
md += [f"| {a} | {b} | {c} |" for a, b, c in CUTS_TABLE]
open("口播稿.md", "w").write("\n".join(md))
print("口播稿.md ok")

pt = [f"# {TITLE} 打点表（源时间码 → 成片时间码）", "",
 f"- 原片 `{RAW:.3f}s` → 成片 `{TOT:.3f}s`，剪掉 `{RAW-TOT:.3f}s`（{(RAW-TOT)/RAW*100:.1f}%）",
 f"- {len(PAIRS)} 个文字组 / {cuts['nframes']} 帧 @30fps / 1080×1920", "",
 "| # | 源起 | 源止 | 成片起 | 成片止 | 大字 | 副字 | 动效 | y |",
 "|---|---|---|---|---|---|---|---|---|"]
for i, (r, t, d) in enumerate(PAIRS, 1):
    pt.append(f"| {i:02d} | {d['s0']:.2f} | {d['s1']:.2f} | {r['out0']:.2f} | {r['out1']:.2f} | "
              f"{d['main'].replace('*','')} | {d['sub']} | {d['device']} | {d['y']} |")
open("打点表.md", "w").write("\n".join(pt))
print("打点表.md ok")
