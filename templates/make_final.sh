#!/bin/zsh
# 重建脚本 —— 顺序不能改（见 production-playbook「按段删除模式」）
#
#   plan.py → mktimeline.py → apply_deletions.py → 清空 deletions.json
#   → 切原片 → 纯人声版 → build.mjs → 逐帧文字层 → 配乐音效 → 合成
#
# apply_deletions.py 必须夹在 mktimeline.py 之后（它要同时改 cuts.json 和 timeline.json）；
# deletions.json 扣完必须清空（已落地的记在 deletions.applied.json），
# 否则 build.mjs 会把「待删」再编进 timeline.js —— 预览会在已经剪好的时间轴上再删一次。
set -e
cd "$(dirname "$0")"

# ===================== 本集配置 =====================
SKILL="${KINETIC_SKILL_DIR:-$HOME/.agents/skills/jackyshen-talking-kinetic-video}"
[ -f "$SKILL/engine/build.mjs" ] || SKILL="/绝对路径/到/skill"
SRC="/绝对路径/原片.mov"
NAME="EP00-标题-口播动效版"
# ===================================================

# 输出目录先建好 —— mkpure.py 就要往 renders/ 里写
mkdir -p renders clips overlay

# ---- 并发锁：两个重建同时跑会把纯人声版写坏 ----
LOCK=".rebuild.lock"
if [ -f "$LOCK" ]; then
  PID=$(cat "$LOCK" 2>/dev/null || echo "")
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "已有重建在跑 (PID $PID)，退出"; exit 3
  fi
  rm -f "$LOCK"
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

echo "== 1/7 基线：切片计划（cuts.json 带 gid）=="
python3 plan.py

echo "== 2/7 基线：时间轴 =="
python3 mktimeline.py

echo "== 3/7 扣掉预览里删掉的段 =="
python3 "$SKILL/engine/apply_deletions.py" --project "$(pwd)" || true
# 已落地 → 记进 deletions.applied.json；清空待删清单，避免重复扣
if [ -f deletions.applied.json ]; then
  python3 - <<'PY'
import json
json.dump({"dels": []}, open("deletions.json", "w"))
print("deletions.json 已清空（已落地记录在 deletions.applied.json）")
PY
fi

TOTAL=$(python3 -c "import json;print(json.load(open('cuts.json'))['total'])")
NFRAMES=$(python3 -c "import json;print(json.load(open('cuts.json'))['nframes'])")
echo "成片目标：${TOTAL}s / ${NFRAMES} 帧"

echo "== 4/7 切原片（去水词/去气口/去重复/去起头 + 已删的段）=="
ffmpeg -v warning -y -i "$SRC" -filter_complex "$(cat cut.filter)" -map "[v]" -map "[a]" \
  -c:v libx264 -preset medium -crf 18 -profile:v high -level 4.0 -r 30 -g 60 -pix_fmt yuv420p \
  -c:a pcm_s16le -ar 48000 -ac 2 cut_raw.mp4

echo "== 5/7 纯人声版（先写临时文件再改名，预览正开着也不会读到半个 mp4）=="
python3 mkpure.py

echo "== 6/7 文字层 =="
node "$SKILL/engine/build.mjs" --project "$(pwd)"
node "$SKILL/engine/render_frames.mjs" --project "$(pwd)" --start 0 --end $TOTAL --fps 30 --out overlay --force

echo "== 7/7 音频 + 合成 =="
python3 mkaudio.py
ffmpeg -v warning -y -framerate 30 -i overlay/frame-%06d.png -i cut_raw.mp4 -i audio_mix.mkv \
  -filter_complex "[1:v][0:v]overlay=0:0:format=auto,format=yuv420p[v]" \
  -map "[v]" -map 2:a -frames:v $NFRAMES \
  -c:v libx264 -preset slow -crf 18 -profile:v high -level 4.0 -r 30 -g 60 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 48000 -ac 2 -movflags +faststart "renders/$NAME.mp4.tmp.mp4"
mv -f "renders/$NAME.mp4.tmp.mp4" "renders/$NAME.mp4"

python3 mkclips.py
python3 mkdocs.py
echo "== DONE =="
