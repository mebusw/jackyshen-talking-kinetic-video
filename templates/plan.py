# -*- coding: utf-8 -*-
"""本集剪辑计划 —— 只改下面「本集配置」区，其余不用动。

产出 cuts.json（切片计划 + src↔out 映射 + 每组对应的行）和 design.json（视觉设计）。
⚠️ cuts.json 必须带两样东西，少了预览里的「删掉这一段」会静默失灵：
  · 每一行 row 的 gid —— 该行属于第几组（**0 基**）；气口/片头/片尾写 -1
  · 顶层的 groups    —— [{"i": 组号, "out0": …, "out1": …}, …]，顺序就是组序
"""
import json, os

# ============================ 本集配置 ============================
SRC  = os.environ.get("EP_SRC", "/绝对路径/原片.mov")
RAW  = 0.0          # 原片时长（秒）—— ffprobe 量出来填这里
TITLE = "EP00 标题"
FPS  = 30
LEAD_IN, TAIL = 0.25, 0.95       # 片头气口 / 片尾留白
KEEP_DEF, KEEP_BEAT = 0.36, 0.55 # 组间气口；关键节拍前留长一点
BEAT_BEFORE = set()              # 哪些组是关键节拍（新章节 / 转折 / 结论）→ 填组号
# (源起, 源止, 主字, 副字, 动效, y, 主字号, 副字号)
#   · 源边界必须落在原片的静音里 —— 剪辑点不切在字中间
#   · 主字 3–8 个字；副字 ≤ 12 个字；字号主 88–160 / 副 44–64
#   · y 是文字块顶边，按实际画面量（别抄别的集的数字）
GROUPS = [
]
# ================================================================

def build():
    keeps = [(0.0, LEAD_IN, None, -1)]
    for i, g in enumerate(GROUPS):
        s0, s1 = g[0], g[1]
        keeps.append((s0, s1, g[2], i))
        if i + 1 >= len(GROUPS):
            continue
        gap = GROUPS[i + 1][0] - s1
        if gap <= 0.20:
            keeps.append((s1, s1 + max(0.0, gap), None, -1))
            continue
        keep = KEEP_BEAT if i in BEAT_BEFORE else KEEP_DEF
        keeps.append((s1, s1 + min(keep, gap), None, -1))
    keeps.append((GROUPS[-1][1], GROUPS[-1][1] + TAIL, None, -1))

    def f2f(t): return int(round(t * FPS))
    rows = []; outf = 0
    for s0, s1, txt, gid in keeps:
        a, b = f2f(s0), f2f(s1)
        if b <= a: continue
        rows.append({"f0": a, "f1": b, "src0": a/FPS, "src1": b/FPS,
                     "out0": outf/FPS, "out1": (outf+b-a)/FPS, "text": txt,
                     "n": b-a, "gid": gid})
        outf += b - a
    total = outf / FPS

    groups_meta = []
    for r in rows:
        if r["gid"] < 0: continue
        groups_meta.append({"i": r["gid"], "out0": r["out0"], "out1": r["out1"]})
    groups_meta.sort(key=lambda g: g["i"])

    json.dump({"fps": FPS, "total": round(total, 3), "nframes": outf,
               "rows": rows, "groups": groups_meta},
              open("cuts.json", "w"), ensure_ascii=False, indent=1)

    design = []
    for i, g in enumerate(GROUPS, 1):
        design.append({"id": f"g{i:02d}", "main": g[2], "sub": g[3], "device": g[4],
                       "y": g[5], "msz": g[6], "ssz": g[7], "s0": g[0], "s1": g[1]})
    json.dump(design, open("design.json", "w"), ensure_ascii=False, indent=1)

    parts = []
    for i, r in enumerate(rows):
        parts.append(f"[0:v]trim=start_frame={r['f0']}:end_frame={r['f1']},setpts=PTS-STARTPTS,scale=1080:1920[v{i}]")
        parts.append(f"[0:a]atrim=start={r['src0']}:end={r['src1']},asetpts=PTS-STARTPTS[a{i}]")
    labels = "".join(f"[v{i}][a{i}]" for i in range(len(rows)))
    fc = ";".join(parts) + ";" + f"{labels}concat=n={len(rows)}:v=1:a=1[v][a]"
    open("cut.filter", "w").write(fc)

    print(f"total {total:.3f}s  frames {outf}  rows {len(rows)}  groups {len(groups_meta)}")
    for r in rows:
        if r["text"]:
            print(f'  {r["out0"]:6.2f}-{r["out1"]:6.2f}  src {r["src0"]:6.2f}-{r["src1"]:6.2f}  gid {r["gid"]:2d}  {r["text"]}')

if __name__ == "__main__":
    build()
