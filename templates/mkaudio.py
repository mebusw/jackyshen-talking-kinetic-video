# -*- coding: utf-8 -*-
"""人声 + 背景音乐 + 音效 → audio_mix.mkv

⚠️ 音效落点必须用「原片时间」写死，不能用成片时间。
   用成片时间的话，删掉前面某一段之后，后面的音效会整体错位。
   运行时用 cuts.json 把原片时间映射到成片时间，删段后自动跟随。
"""
import subprocess, os, re, json

# ============================ 本集配置 ============================
SKILL = os.environ.get("KINETIC_SKILL_DIR", os.path.expanduser("~/.agents/skills/jackyshen-talking-kinetic-video"))
BGM_FILE  = "音乐-资源库/充满希望的钢琴曲19.mp3"   # 从共享音乐库选，别每集都用同一首
BG_START  = 12.0        # 这首曲从第几秒开始是满能量（先量 RMS 再填）
BG_GAIN   = -14         # dB，铺底不能压过人声
TARGET_I, TARGET_TP = -16.5, -1.5
COMP = "acompressor=threshold=-28dB:ratio=2.5:attack=5:release=150:makeup=1"
# (文件, **原片**落点秒, 增益dB) —— 全部取自 音效-资源库/剪映音效，禁止自造
# 重音（重点强调）每 60 秒最多 3 次
CUE = [
]
# ================================================================

SFX = os.path.join(SKILL, "resources/音效-资源库/剪映音效")
BGM = os.path.join(SKILL, "resources", BGM_FILE)

cuts = json.load(open("cuts.json"))
rows = cuts["rows"]
TOTAL = cuts["total"]

def src_to_out(s):
    """原片时间 → 成片时间。落在被剪掉的区间里就顺延到下一个保留段的起点。"""
    for r in rows:
        if r["src0"] - 1e-6 <= s < r["src1"] + 1e-6:
            return r["out0"] + (s - r["src0"])
    for r in rows:
        if r["src0"] > s:
            return r["out0"]
    return None

CUE_OUT = []
for f, s, g in CUE:
    t = src_to_out(s)
    if t is None or t >= TOTAL:
        print("  跳过音效（已随内容剪掉）:", f, "src", s)
        continue
    CUE_OUT.append((f, round(t, 3), g))
print("音效落点:", len(CUE_OUT), "个")

r = subprocess.run(["ffmpeg", "-v", "info", "-i", "cut_raw.mp4", "-af",
                    f"{COMP},loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA=11:print_format=json", "-f", "null", "-"],
                   capture_output=True, text=True)
m = json.loads(re.search(r'\{[^{}]*"input_i"[^{}]*\}', r.stderr, re.S).group(0))
print(f"measured: I={m['input_i']} TP={m['input_tp']} LRA={m['input_lra']}")
VO = (f"{COMP},loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA=11:"
      f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:"
      f"measured_thresh={m['input_thresh']}:linear=true")

inp = ["-i", "cut_raw.mp4", "-i", BGM]
for f, _, _ in CUE_OUT: inp += ["-i", os.path.join(SFX, f)]
fc = [f"[0:a]{VO},asplit=2[vo][vokey];"]
fc.append(f"[1:a]atrim=start={BG_START}:end={BG_START+TOTAL},asetpts=N/SR/TB,volume={BG_GAIN}dB,"
           f"afade=t=in:st=0:d=1.5,afade=t=out:st={max(0,TOTAL-3.0):.3f}:d=3.0[bgm];")
fc.append("[bgm][vokey]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=400[bg];")
for i, (f, t, g) in enumerate(CUE_OUT):
    ms = int(round(t * 1000))
    fc.append(f"[{i+2}:a]adelay={ms}|{ms},volume={g}dB[s{i}];")
labels = "[vo][bg]" + "".join(f"[s{i}]" for i in range(len(CUE_OUT)))
fc.append(f"{labels}amix=inputs={2+len(CUE_OUT)}:duration=first:normalize=0,alimiter=limit=0.794:level=disabled[aout]")
cmd = ["/opt/homebrew/bin/ffmpeg", "-v", "warning", "-y"] + inp + \
      ["-filter_complex", ";".join(x.rstrip(";") for x in fc),
       "-map", "0:v", "-map", "[aout]", "-c:v", "copy",
       "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "audio_mix.mkv"]
subprocess.run(cmd, check=True)
print("audio_mix.mkv ok  total=%.3f" % TOTAL)
