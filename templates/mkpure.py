# -*- coding: utf-8 -*-
"""纯人声版：切完后只有「压缩 + 归一化」的人声，无配乐/音效/文字层。

先写临时文件再改名 —— 预览正开着的时候绝不能读到半个 mp4。
"""
import subprocess, re, json, os

# ===================== 本集配置 =====================
NAME = "EP00-标题"
# ===================================================

COMP = "acompressor=threshold=-28dB:ratio=2.5:attack=5:release=150:makeup=1"
r = subprocess.run(["ffmpeg", "-v", "info", "-i", "cut_raw.mp4", "-af",
                    f"{COMP},loudnorm=I=-16.5:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                   capture_output=True, text=True)
m = json.loads(re.search(r'\{[^{}]*"input_i"[^{}]*\}', r.stderr, re.S).group(0))
af = (f"{COMP},loudnorm=I=-16.5:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
      f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:linear=true")
out = f"renders/{NAME}-纯人声版.mp4"
tmp = out + ".tmp.mp4"
subprocess.run(["ffmpeg", "-v", "warning", "-y", "-i", "cut_raw.mp4", "-af", af, "-map", "0:v", "-map", "0:a",
                "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-level", "4.0",
                "-r", "30", "-g", "60", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", tmp], check=True)
os.replace(tmp, out)
print("纯人声版 ok")
