# -*- coding: utf-8 -*-
"""分段切片：每组大字切成一段，可直接拆成多条短视频。被删掉的组（dead）不切。"""
import json, subprocess, os

# ===================== 本集配置 =====================
NAME = "EP00-标题"
# ===================================================

tl = json.load(open("timeline.json"))
F = f"renders/{NAME}-口播动效版.mp4"
os.makedirs("clips", exist_ok=True)
names = []
for g in tl["groups"]:
    if g.get("dead") or g["t1"] - g["t0"] < 0.2:
        continue
    m = [i for i in g["items"] if i["role"] == "main"][0]["text"].replace("*", "")
    names.append((g, f"{len(names)+1:02d}-{m}"))
for g, n in names:
    dur = round(g["t1"] - g["t0"] + 0.32, 3)
    out = f"clips/{n}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{g['t0']:.3f}", "-t", f"{dur:.3f}", "-i", F,
                    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high",
                    "-pix_fmt", "yuv420p", "-r", "30",
                    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out], check=True)
    print(n, dur)
