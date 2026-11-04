---
name: jackyshen-talking-kinetic-video
description: 剪辑真人口播短视频并制作网感动效文字、跟读字幕、圆形蒙版转场、浏览器内预览编辑和按段删除重建。用于“真人口播动效视频”“网感口播”“动态大字”“预览后重剪”等任务；不用于横屏宣传片、纯字幕视频或没有真人素材的纯动效短片。
metadata:
  short-description: 网感口播动效视频编辑器
---

# 网感口播动效视频编辑器

这套 skill 本身就是唯一事实源。工程目录只放本集素材、时间轴、脚本和产物；不要复制 `engine/`、`resources/音乐-资源库/` 或 `resources/音效-资源库/` 到工作目录。

完整的创作规范、七套视觉风格、时间轴约定、动效实现、预览编辑器、按段删除、音频和 QA 规则都在 [references/production-playbook.md](references/production-playbook.md)。进入实际剪辑前先读它；只做局部修改时再查对应章节。

## 路径

设 `<skill-dir>` 为包含本 `SKILL.md` 的目录。标准安装位置是：

```text
$HOME/.agents/skills/jackyshen-talking-kinetic-video
```

共享资源固定从 skill 读取：

```text
<skill-dir>/engine/
<skill-dir>/resources/音乐-资源库/
<skill-dir>/resources/音效-资源库/
```

不要在项目里再建一份引擎或音频库。项目可以放在任意目录；脚本通过 `--project <目录>` 指向它。

首次安装 skill 后在 skill 目录执行一次：

```bash
npm install
```

依赖只装在 skill 自身目录，不装进各个项目。

## 新项目

```bash
python3 "<skill-dir>/scripts/create_project.py" "/absolute/path/to/EPxx"
```

生成的是薄项目：

```text
EPxx/
├── source/           原始视频/音频
├── renders/          纯人声版、最终成片
├── clips/            分段切片
├── qa/               抽帧与检查
├── timeline.json     本集内容
├── preview.sh        启动共享预览服务
└── .gitignore
```

不要生成或依赖项目级 `AGENTS.md`。通用规则由本 skill 维护。

## 构建与预览

```bash
node "<skill-dir>/engine/build.mjs" --project "/absolute/path/to/EPxx"
node "<skill-dir>/engine/preview_server.mjs" --project "/absolute/path/to/EPxx"
```

预览地址由服务打印，形如 `http://127.0.0.1:8787/index.html?preview=1&edit=1`。预览默认自动使用项目 `renders/` 中文件名含 `纯人声版` 的 MP4，不复制第二份视频。

在 Codex 桌面端交付时，要主动给用户一个可点击的 `preview` 链接，并优先用 `open_in_codex` 把该 HTTP 地址推进右侧边栏。若工具暂时不可用，再给普通 Markdown 链接。预览完成后要明确说明：它是动效预览，最终文件仍在 `renders/`。

## 渲染与重建

```bash
node "<skill-dir>/engine/render_frames.mjs" --project "/absolute/path/to/EPxx" \
  --start 0 --end <总秒数> --fps 30 --out overlay --force
```

项目自己的 `rebuild.sh` / `make_final.sh` 负责切片、纯人声版、文字层、音频和合成。脚本里调用引擎时必须指向 `<skill-dir>/engine/...`，不能依赖项目内副本。

按段删除的完整链路必须先读 production playbook 的“预览模式与 Codex 交付”和“构建与质量检查”两节。预览删除后要立即在浏览器里跳过对应视频区间；保存并重建期间必须锁住编辑界面。

## 声音

- 背景音乐只能从 `<skill-dir>/resources/音乐-资源库/` 选择。
- 音效只能从 `<skill-dir>/resources/音效-资源库/剪映音效/` 选择。
- 选音效前先读 `音效索引.json` 与 `使用规则.md`。
- 禁止自行合成、从网络下载或把音频库复制进项目。

## 质量底线

- 真人和真实口播是主体；动效只强化表达。
- 先校订口播和时间码，再设计文字；不得臆造原片内容。
- 文字位置按实际画面测量，默认竖屏 1080×1920，底部 Y 带为画面高度 49%–78%。
- 交付前至少检查：内容、布局、动效中间帧、蒙版最小孔、音画同步、时长、分辨率、帧数、响度和实际播放。
- 修改公共引擎后，先做旧时间轴回归，再同步到 skill 和 GitHub。
