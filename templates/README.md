# 模板 —— 每集自己的那几份脚本

`engine/` 是公共引擎（共享、只维护一份），`resources/` 是共享音乐和音效库。
这一目录放的是**每集自己一份**的剪辑脚本：它们要按本集内容改，所以不能共享。

新项目直接从这里拷，不要凭记忆重写 —— 这几份脚本里踩过的坑不要再踩一遍。

| 文件 | 干什么 | 关键点 |
|---|---|---|
| `plan.py` | 写 `cuts.json`（切片计划）+ `design.json`（视觉设计） | **每行必须带 `gid`、顶层必须有 `groups`** —— 少了这两样，预览里的「删掉这一段」会静默失灵（点了没反应、也不报错） |
| `mktimeline.py` | `cuts.json` + `design.json` → `timeline.json` | 会**沿用上一版改过的文字/字号/Y**，否则重建一次就把预览里刚改好的字冲回原文 |
| `mkaudio.py` | 人声 + 音乐 + 音效 → `audio_mix.mkv` | 音效落点用**原片时间**写死（运行时映射到成片时间），删段后音效自动跟随、不会整体错位 |
| `mkpure.py` | 纯人声版 | 先写 `.tmp` 再改名 —— 预览开着的时候不会读到半个 mp4 |
| `mkclips.py` | 分段切片 | 跳过被删掉的组（`dead`） |
| `mkdocs.py` | 口播稿 / 打点表 / 独立字幕 `.srt` | 按 `gid` 对齐，不靠行序 —— 删段后行会消失，用行序会整体错位 |
| `make_final.sh` | 重建脚本 | 顺序固定：`plan → mktimeline → apply_deletions → 清空 deletions.json → 切 → 纯人声版 → build → 逐帧 → 配乐 → 合成`；带并发锁；成片先写临时文件再改名 |

## 用法

```bash
python3 "<skill-dir>/scripts/create_project.py" "/绝对路径/EPxx" --title "EPxx 标题"
# 模板已经拷进项目目录
cd "/绝对路径/EPxx"
```

然后逐个改「本集配置」区：

| 文件 | 要改的 |
|---|---|
| `plan.py` | `SRC`、`RAW`、`TITLE`、`GROUPS`、`BEAT_BEFORE` |
| `mktimeline.py` | `TITLE`、版心带 `yMin` / `yMax` |
| `mkaudio.py` | `BGM_FILE`、`BG_START`、`BG_GAIN`、`CUE`（音效落点） |
| `mkpure.py` / `mkclips.py` / `mkdocs.py` | `NAME`（成片名，三份要一致） |
| `mkdocs.py` | `TEXT`（逐组口播稿）、`TERMS`（术语校订）、`CLEANUP`（清理清单）、`CUTS_TABLE`（剪掉对照） |
| `make_final.sh` | `SRC`、`NAME` |

`apply_deletions.py` **不用拷**，它属于引擎，直接从 `<skill-dir>/engine/` 拿。

## 怎么验收

```bash
python3 -c "import json; c=json.load(open('cuts.json')); print(c['rows'][3]['gid'], len(c['groups']))"
# 应输出：组号（整数） 组数（等于 GROUPS 的条数）
```

然后：

```bash
node "<skill-dir>/engine/build.mjs" --project "$(pwd)"     # 预检不过就别往下走
node "<skill-dir>/engine/render_frames.mjs" --project "$(pwd)" --start 0 --end <总秒数> --fps 30 --out overlay --force
```

最后打开预览，点「段」→「删掉这一段」验一次删除按钮真的有反应。
