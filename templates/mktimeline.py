# -*- coding: utf-8 -*-
"""cuts.json + design.json → timeline.json（机器可读的时间轴）。

两点必须记住：
  · 只改「主字/副字/字号/Y」不在这份脚本里 —— 那些在预览的「✎ 编辑」里改。
    所以这里要**沿用上一版 timeline.json 里改过的值**，否则一次重建就把预览里
    刚改好的字冲回 design.json 里的原文。
  · 每个 group 必须恰好 1 个 main 项；同屏文字块 ≤ 3；y 要落在版心带内。
    build.mjs 会逐条校验，不过就先别往下走。
"""
import json, os

TITLE = "EP00 标题"   # 与 plan.py 保持一致

cuts   = json.load(open("cuts.json"))
design = json.load(open("design.json"))
R = [r for r in cuts["rows"] if r["text"]]
assert len(R) == len(design), (len(R), len(design))

# 沿用上一版改过的文字 / 字号 / Y（item id 在组序不变时是稳定的）
OLD = {}
if os.path.exists("timeline.json"):
    try:
        for g in json.load(open("timeline.json")).get("groups", []):
            for it in g.get("items", []):
                OLD[it["id"]] = {"text": it.get("text"), "size": it.get("size"), "dy": it.get("dy")}
    except Exception:
        OLD = {}

def carry(iid, text, size):
    o = OLD.get(iid)
    if not o:
        return text, size, None
    if o.get("text") is not None: text = o["text"]
    if o.get("size"):             size = o["size"]
    return text, size, o.get("dy")

groups = []
for n, (r, d) in enumerate(zip(R, design), 1):
    gid = f"g{n:02d}"
    main, sub, dev, y, msz, ssz = d["main"], d["sub"], d["device"], d["y"], d["msz"], d["ssz"]
    # EXT = 与下一句之间的空档长度；只有「大字行」的退场动画铺满这个空档，
    # 于是新句压入时旧大字仍留在原地缩淡 —— 叠印转场，而不是「先消失再出新句」。
    # 副字行不延长：否则空档里同屏会出现 4 个文字块，超过「同屏 ≤ 3 块」的上限。
    ext = 0.0
    if n < len(R):
        ext = round(R[n]["out0"] - r["out1"], 3)
    main, msz, mdy = carry(f"{gid}-m", main, msz)
    sub,  ssz, sdy = carry(f"{gid}-s", sub,  ssz)
    groups.append({
        "id": gid, "t0": r["out0"], "t1": r["out1"], "y": y,
        "items": [
            {"id": f"{gid}-m", "role": "main", "text": main, "size": msz,
             "device": dev, "t0": r["out0"], "t1": round(r["out1"] + ext, 3),
             **({"dy": mdy} if mdy else {})},
            {"id": f"{gid}-s", "role": "sub", "text": sub, "size": ssz,
             "device": "fade", "t0": round(r["out0"] + 0.30, 3), "t1": r["out1"],
             **({"dy": sdy} if sdy else {})},
        ],
    })

tl = {
    "meta": {
        "title": TITLE,
        "width": 1080, "height": 1920, "fps": 30,
        "total": cuts["total"], "nframes": cuts["nframes"],
        "palette": {"ink": "#FFFFFF", "sub": "#C7CFDC", "accent": "#FEBD0D", "scrim": "#06080C"},
        # 版心带：文字块顶边必须落在这个区间内 —— 按实际画面量，别抄别的集
        "yMin": 1235, "yMax": 1300,
        "inDur": 0.42, "outDur": 0.32,
    },
    "groups": groups,
}
json.dump(tl, open("timeline.json", "w"), ensure_ascii=False, indent=1)
print("timeline.json ok  groups=%d  total=%.3f  frames=%d" % (len(groups), cuts["total"], cuts["nframes"]))
