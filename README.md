# Social-media-savvy-talking-head-kinetic-video

**网感口播动效视频编辑器**

这是一个可直接安装为 Codex skill 的真人口播短视频制作仓库，包含动效文字引擎、浏览器预览编辑器、按段删除与重建链路、共享音乐库、共享音效库和完整制作规范。

## 设计原则

- 仓库本身就是 skill，也是引擎和共享音频的唯一事实源。
- 新项目只保存本集素材、时间轴和产物。
- 不复制 `engine/`、字体、音乐库或音效库到项目目录。
- 预览始终复用同一套引擎和音频资源；项目里的纯人声版只保留一份。

## 安装

```bash
git clone https://github.com/mebusw/Social-media-savvy-talking-head-kinetic-video.git \
  "$HOME/.agents/skills/social-media-savvy-talking-head-kinetic-video"
cd "$HOME/.agents/skills/social-media-savvy-talking-head-kinetic-video"
npm install
```

安装后使用：

```text
$social-media-savvy-talking-head-kinetic-video
```

## 新建项目

```bash
python3 "$HOME/.agents/skills/social-media-savvy-talking-head-kinetic-video/scripts/create_project.py" \
  "/absolute/path/to/EPxx" --title "EPxx 标题"
```

## 预览

```bash
node "$HOME/.agents/skills/social-media-savvy-talking-head-kinetic-video/engine/preview_server.mjs" \
  --project "/absolute/path/to/EPxx"
```

服务会打印可点击的 `preview` 地址；在 Codex 中可推进右侧边栏直接预览。

## 目录

```text
.
├── SKILL.md                         skill 入口
├── agents/openai.yaml               UI 元数据
├── engine/                          动效引擎、预览编辑器和渲染器
├── resources/音乐-资源库/            共享背景音乐
├── resources/音效-资源库/            共享剪映音效
├── references/production-playbook.md 完整制作规范
└── scripts/create_project.py        创建薄项目
```

## 权利说明

音乐和音效位于公开仓库中。发布、转载或对外分发前，请自行确认素材授权范围。
