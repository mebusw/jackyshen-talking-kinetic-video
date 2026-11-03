# 公共引擎模板（TP02 起 · 新 EP 一律从这里拷）

> 这是**从 EP06 引擎抽出来的公共版**，加上「上下裂开」设备。
> 新开一集时：**整个目录拷成 `EPxx-真人口播动效版/`**，然后改 `timeline.json` 就行。
> 已做好的 EP **不回改**（EP01–EP09 保持原样）。

## 目录

```
引擎-模板/
├── index.html              动画引擎（文字层 + 圆形蒙版 fx 层 + split 设备）
├── build.mjs               时间轴编译 + 构建期强校验
├── render_frames.mjs       逐帧渲染（playwright → 透明 PNG 序列）
├── timeline.json           ← 换成你自己那集的时间轴
├── 示例-时间轴-含split.json  一个可直接跑的例子（见下）
└── assets/
    └── brush.ttf           手写体（裂开后的第二句用）
```

> `assets/` 里还要放 `NotoSansSC-Var.ttf`（各集自己的 assets/ 里都有，直接拷过来）。
> 字体缺失时 `build.mjs` 不会报错，但渲染出来会掉字体 —— **渲染后一定要抽帧目视**。

## 引擎里有什么

| 能力 | 说明 | 来自 |
|---|---|---|
| 5 种入场设备 | `drop` / `wipe` / `slam` / `slideL` / `type` | EP01 起 |
| **圆形蒙版转场** | `timeline.json` 的 `fx` 数组驱动（`radial-gradient` + `maskImage`），圆孔最小只收到「主播大头」大小 | **EP06** |
| **上下裂开** | `device:'split'` + `role:'crack'`，一行字撕成上下两半，中间长出第二句 | **本模板新增** |
| 黑描边 | 主字 8px / 副字 5px，`paint-order: stroke fill` | TP02 起 |
| 底部跟读层 | 每组 `g.y` 浮动，构建期强制落在画面 49%–78% | TP02 起 |
| 叠印转场 | 构建期允许组间重叠 ≤ 0.45s | TP02 起 |

## 圆形蒙版（fx）怎么用

在 `timeline.json` 顶层加 `fx` 数组：

```json
"fx": [
  { "id":"fx1", "mode":"keys", "t0":0, "t1":1.3, "cx":50, "cy":52,
    "k":[ {"t":0, "r":430, "ease":"out"}, {"t":1.3, "r":2400, "ease":"out"} ] }
]
```
- `r` = 圆孔半径（像素）。**430 ≈ 收到主播大头大小**，2400 = 全屏打开（比画面对角线 2203 大即可）
- `ease`：`in` / `out` / `inout`
- 蒙版压在**文字层之下**（`#fx` z-index 10 / `#band` z-index 20），转场时文字始终可读
- **做转场音效时，把音效落在圆孔收到大头的那一帧**

## 上下裂开（split）怎么用

一组里放两个 item：`main` 用 `device:'split'`，第二句用 `role:'crack'`。

```json
{ "id":"g03", "y":1300, "t0":9.60, "t1":14.40, "items":[
  {"id":"g03-m","role":"main","text":"花几个月","size":118,"device":"split",
   "t0":9.60,"t1":14.40,"split":{"at":1.00,"gap":76,"dur":0.80}},
  {"id":"g03-c","role":"crack","text":"几分钟","size":112,"device":"fade",
   "t0":11.45,"t1":14.40}
]}
```
- `split.at` = 出现后多久开始撕；`split.dur` = 撕的过程多长；`split.gap` = 两半各移多远（**空隙高 = 2×gap**）
- `crack` 的 `t0` 必须 ≥ `main.t0 + at + dur`（构建期会拦，误差容忍 0.35s）
- `crack` 的字号高度不能超过 `2×gap`（构建期会拦）
- `split` 必须是**单行**（构建期会拦）
- **汉字被水平切半是效果本身的代价**（「花」会变成两截），不是 bug。选字少、笔画粗的句子更耐切
- 手写体描边只给 **4px**（7px 会把笔画吃掉）

## 三个静默失败的坑

1. **容器宽度塌成 0** —— split 的两半如果都写 `position:absolute`，容器没宽度 → 整句消失。
   必须用 `display:inline-grid` 让容器由内容撑开。
2. **出场缩放落错地方** —— `scale` 必须落在 `.splitwrap` 上，不能落在 `.tw` 上，否则两半错位。
3. **字体没加载** —— `render_frames.mjs` 里原来写的 `400 200px "Qing Brush"` 是**不存在的字体名**，
   那个 `document.fonts.load` 一直是空操作。模板已改成 `400 112px "brush"`（brush.ttf 的别名）。
   `brush.ttf` 的真实字体名是 **ZiYuQingMeiYingBi**。

## 跑一遍

```bash
cd EPxx-真人口播动效版
node build.mjs                                    # timeline.json -> timeline.js + 预检
node render_frames.mjs --start 0 --end <总时长> --fps 30 --out overlay --force
ffmpeg -framerate 30 -i overlay/frame-%06d.png -i cut_raw.mp4 -i audio_mix.mkv \
  -filter_complex "[1:v][0:v]overlay=0:0:format=auto,format=yuv420p[v]" \
  -map "[v]" -map 2:a -frames:v <帧数> -t <总时长> ... renders/成片.mp4
```

---

## 预览模式（`?preview=1` · 2026-11-03 加）

设计时不想等 2.5 分钟渲染？**在浏览器里直接看**：

```
<工程目录>/index.html?preview=1
```

- 画面做底（`<video>` + `z-index:0`），文字/蒙版照旧 → **所见即所得**
- 底部控件条：播放/暂停、时间码、时间轴
- 时间轴上：**蓝柱 = 每组大字的起点**（鼠标悬停看文字，点击跳转）、**黄柱 = 圆形蒙版转场**（点击直接跳到圆孔最小那一帧）
- 快捷键：`空格` 播放/暂停 · `←→` 单帧 · `Shift+←→` 1 秒 · `↑↓` 跳上/下一组大字 · `Home/End` 首尾

### 视频从哪来
**自动用 `renders/*纯人声版.mp4`**，不需要再拷任何一份中间片。

纯人声版就是「剪完 + 归一化」的原片：有画面、有归一化的人声，没有文字、没有配乐音效。
`build.mjs` 编译时扫 `renders/`，把找到的路径写进 `timeline.js` 的 `meta.previewSrc`：

```js
{ "meta": { …, "previewSrc": "renders/EPxx-xxx-纯人声版.mp4" } }
```

> ⚠️ 所以流水线里 **`mkpure.py` 必须排在 `node build.mjs` 之前**，否则编译时还探测不到纯人声版。

要临时换片仍可用 `?src=` 指定；`?mute=1` 静音。找不到文件时页面中央会提示。

### 播放的是纯人声版，不是最终混音

预览里**没有配乐和音效**（纯人声版只保留人声）。它的用途是对动效、对版面、对蒙版转场；
要听完整混音，直接开 `renders/*口播动效版.mp4`。

### 关键设计：生产路径完全不受影响
预览的代码在 `index.html` 末尾，**只在 `location.search` 含 `preview` 时才执行**：
不进预览模式时，DOM 与加预览之前**逐字节一致**（video 元素是 JS 动态注入的，不是写死在 HTML 里的）。
已用 135 帧做过回归：新旧引擎输出**逐字节一致** ✅

> ⚠️ 回归脚本两个坑：① `--start/--end` 是**秒**不是帧号（帧号 = 秒 × 30），我第一次把帧号当秒传，
> 测试区间互相覆盖，出现假差异；② 务必加一个「同一引擎跑两遍」的对照组，否则分不清真回归和渲染抖动。

---

## 预览编辑器（`?preview=1`）

工具条上有两个按钮：

- **✎**（或按 `E`）→ 文字编辑器：点屏幕上的字块选中 → 右侧面板改文字（`*字*` = 高亮）/ 字号 / Y 位置；拖动字块移动、拖右下角小方块缩放；「保存并重建」写回 `timeline.json`（留 `.bak`）并自动跑 `build.mjs`；「引用到对话」把这一组的信息复制到剪贴板。
  - **大字和下面的小字各自独立**，拖大字不会带着小字走。
  - 播放头是红色的。
- **字** → 逐字删除模式（见下）。

## 按段删除模式（`?preview=1` + 「段」按钮）

时间轴上两条蓝线之间 = 一句话/一个短语 = 一个删除单位。

- 点蓝色段块选中 → 「删掉这一段」（或 Delete）→ 预览里立刻跳过，后面整体前移
- 删掉的地方在时间轴上留一道**红色斜纹切痕**，底部还列一个红色标签，一眼看得见
- 「撤销上一次删除」：只撤最近一次；没有可撤时按钮是灰的（撤销会自动写回清单）
- 「引用」：复制到剪贴板 + 中间弹一条 toast（网页没法直接写进 Codex 对话框）
- 「保存并重建」：**一个按钮**搞定（存清单 + 重出成片）；重建期间整个界面锁住并弹窗显示实时日志，
  避免你继续改、后台还在按旧清单剪，两边打架
- 文字块编辑（**✎** / `E`）照旧：点画面上的字块改文字/字号/位置/高亮

不做逐字粒度：几百个字实时重绘会卡、切在字中间容易出咔哒声，一句话已经够用。

### 需要的三份数据

| 文件 | 谁生成 | 说明 |
|---|---|---|
| `cuts.json` | `plan.py` → `apply_deletions.py` | 切片计划；每组对应哪些行（`gid`）也在这里 |
| `deletions.json` | 预览编辑器 | 待删的段（原片时间） |
| `timeline.json` | `mktimeline.py` → `apply_deletions.py` | 时间轴（`build.mjs` 会把 cuts 编进 `timeline.js`） |

### 重建流水线（顺序不能改）

```
plan.py → mktimeline.py → apply_deletions.py → 切片 → 纯人声版 → build.mjs → 逐帧 → 音频 → 合成
```

`apply_deletions.py` 是通用的：读 `cuts.json` + `deletions.json`（+ `deletions.applied.json`），
扣掉被删的帧，重排 `cuts.json`（out 时间、帧数）和 `timeline.json`（所有时间点），并生成 `cut_fast.filter`。

- 按**帧**算，不是按秒；浏览器那边也必须按帧，两边逐帧一致才对得上
- 舍入用 `Math.round` 语义（Python 写 `int(math.floor(x+0.5))`）
- 横跨删除点的一组：`t0` 不动、`t1` 提前（动画不跳帧，尾巴剪短）
- 整组被删完：标记 `dead` 保留在列表里（下游按序号对齐的脚本不能错位），渲染时跳过
- 扣完立刻清空 `deletions.json`（历史留 `deletions.applied.json`），否则会在已剪好的时间轴上再删一次

## 本地预览服务

```
node preview_server.mjs     →  http://127.0.0.1:8787/index.html?preview=1
```

- 静态托管本集目录（支持 Range，视频能拖）
- `POST /api/save` → 写 `timeline.json` / `deletions.json`（留 `.bak`）+ 自动 build
- `POST /api/rebuild` → 后台跑 `rebuild.sh`（或 `make_final.sh`），日志写 `.rebuild.log`
- `GET /api/progress` → 重建进度
- 端口被占就顺延（最多试 20 个）

### 四个坑（都真踩过）

1. **预览「字幕删了、画面没删」** —— 不要用 `vid.currentTime - skew` 反推时钟。时钟按真实时间走，
   视频跟它对齐（差 > 60ms 才 seek），某次 seek 失败下一帧会自动纠回来。
2. **两个重建同时跑会把纯人声版写坏** —— `rebuild.sh` 有 `.rebuild.lock` 锁；
   `mkpure.py` / 成片必须**先写临时文件再改名**，否则预览会读到半个 mp4，报 `Invalid NAL unit size`。
3. **删除落地后必须清空 `deletions.json`** —— 否则 `build.mjs` 会把它再编进 `timeline.js`，
   预览在已经剪好的时间轴上再删一次，字幕比画面提前，必然错位。
   已落地的记在 `deletions.applied.json`，`apply_deletions.py` 每次合并 applied + pending 再扣。
4. **重建在跑的时候别改 `rebuild.sh`** —— bash 边读边执行，改到一半会 `syntax error` 自杀。
5. **改了 js 页面没反应 = 被代理缓存了** —— 服务器送 HTML 时会给 `<script src>` 加上
   `?v=<文件修改时间>`，版本号一变 URL 就变，代理必须回源。别去掉这个。
