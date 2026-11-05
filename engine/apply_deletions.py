# -*- coding: utf-8 -*-
"""把 deletions.json 里的「删掉的词」扣到切片计划上，并同步平移时间轴。

用法（在每一集目录里跑）：
    python3 apply_deletions.py            # 基线：cuts.json + timeline.json 就地改写
    python3 apply_deletions.py --fast     # 额外产出 cut_fast.filter（从 cut_raw.mp4 再切一刀，快 5 倍）

也可以直接从 skill 的公共引擎跑，不用往项目里拷一份：
    python3 "<skill-dir>/engine/apply_deletions.py" --project "/绝对路径/EPxx"

输入
    cuts.json       基线切片（每行是原片的一帧区间）
    deletions.json  {"dels":[{"s0":12.30,"s1":13.10}]}   —— 原片时间（秒），互不重叠
    timeline.json   基线时间轴（成片时间）

输出
    cuts.json       重排后的行 + 新的 out 时间 + 新的总长
    timeline.json   所有时间点按「删除量」平移（删在中间 → 跨过的那组就地截断）
    cut.filter      从原片切的滤镜（f0/f1 = 原片帧号）
    cut_fast.filter 从已有 cut_raw.mp4 再切一刀（老 out 帧号 → 新 out 帧号）

时间映射的语义（重要）
    删掉一段视频 = 这段视频消失，后面所有内容整体提前。
    · 完全在删除点之后的组：t0/t1 一起提前 Δ
    · 横跨删除点的组：t0 不动，t1 提前 Δ（动画不跳帧，只是尾巴被剪短）
    · 完全落在删除区间里的组：塌成 0 长度 → 整组丢掉
"""
import json, os, sys, argparse, math

def fr(x):
    """四舍五入（和 JS 的 Math.round 一致，不用 Python 的银行家舍入）"""
    return int(math.floor(x + 0.5))
FPS = 30

ap = argparse.ArgumentParser()
ap.add_argument('--fast', action='store_true', help='额外产出 cut_fast.filter（从 cut_raw.mp4 再切）')
ap.add_argument('--cutraw', default='cut_raw.mp4')
ap.add_argument('--src', default=None, help='原片路径（写进 cut.filter 的注释用）')
ap.add_argument('--project', default=None,
                help='项目目录（默认 = 本脚本所在目录）。'
                     '从 skill 的 engine 目录直接跑时用这个参数，就不用往项目里拷一份')
args = ap.parse_args()
ROOT = os.path.abspath(args.project) if args.project else os.path.dirname(os.path.abspath(__file__))
if not os.path.isdir(ROOT):
    sys.exit('项目目录不存在：%s' % ROOT)


def load(name, default=None):
    p = os.path.join(ROOT, name)
    if not os.path.exists(p):
        return default
    return json.load(open(p, encoding='utf-8'))


def save(name, data):
    json.dump(data, open(os.path.join(ROOT, name), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)


cuts = load('cuts.json')
# 待删（deletions.json）+ 已经落地过的（deletions.applied.json）
# —— 后者保证「重新跑 plan.py 时，之前删掉的词还会继续被扣掉」
pend = load('deletions.json', {"dels": []}) or {"dels": []}
applied_doc = load('deletions.applied.json', {"dels": []}) or {"dels": []}
merged_doc = {"dels": (applied_doc.get('dels') or []) + (pend.get('dels') or [])}
tl = load('timeline.json')
if cuts is None:
    sys.exit('找不到 cuts.json')
dels = sorted([(float(d['s0']), float(d['s1']))
               for d in merged_doc['dels'] if d['s1'] > d['s0']])

# ---- 合并重叠的删除区间 ----
merged = []
for a, b in dels:
    if merged and a <= merged[-1][1] + 1e-6:
        merged[-1][1] = max(merged[-1][1], b)
    else:
        merged.append([a, b])
dels = merged

def write_fast_filter(segs):
    """从 cut_base.mp4 再切一刀用的滤镜（老 out 帧 -> 新 out 帧）"""
    fparts, flabels = [], []
    for i, (a, b, c, d) in enumerate(segs):
        fparts.append("[0:v]trim=start_frame=%d:end_frame=%d,setpts=PTS-STARTPTS[v%d]" % (a, b, i))
        fparts.append("[0:a]atrim=start=%.4f:end=%.4f,asetpts=PTS-STARTPTS[a%d]" % (a / FPS, b / FPS, i))
        flabels.append("[v%d][a%d]" % (i, i))
    ffc = ";".join(fparts) + ";" + "".join(flabels) + "concat=n=%d:v=1:a=1[v][a]" % len(segs)
    open(os.path.join(ROOT, 'cut_fast.filter'), 'w').write(ffc)


if not dels:
    print('没有删除区间 —— cuts.json / timeline.json 原样保留')
    # 仍然要出 cut_fast.filter（恒等映射），重建脚本统一走「从 cut_base.mp4 再切」这条路
    idsegs, acc = [], 0
    for r in cuts['rows']:
        n = int(r['n'])
        idsegs.append((acc, acc + n, acc, acc + n))
        acc += n
    write_fast_filter(idsegs)
    sys.exit(0)

# ---- 删除区间 -> 原片帧号 ----
# 记一份「已经落地」的清单
save('deletions.applied.json', {"dels": [{"s0": round(a, 4), "s1": round(b, 4)} for a, b in dels]})

df = [[fr(a * FPS), fr(b * FPS)] for a, b in dels]
df = [[max(0, x), y] for x, y in df if y > x]
removed_total = sum(y - x for x, y in df)
print('待删 %d 段（原片共 %.3fs）' % (len(df), removed_total / FPS))

rows = cuts['rows']
orig_frames = sum(int(r['n']) for r in rows)
removed = []          # 被删掉的老成片时间区间（帧）
new_rows = []
segs = []          # (oldOutStart, oldOutEnd, newOutStart, newOutEnd)  帧
old_out = 0
new_out = 0
for r in rows:
    r0, r1 = int(r['f0']), int(r['f1'])
    base_old = old_out          # 这一行在「老成片时间」里的起始帧（拆行时不能被推着走）
    # 这行里被删掉的帧
    cuts_in = [(x, y) for x, y in df if x < r1 and y > r0]
    if not cuts_in:
        n = r1 - r0
        # 这一行整段保留，但成片时间要跟着前面被删的部分前移 —— 不更新的话，
        # 删点之后的行会留着「删之前的」out0/out1，
        # 浏览器预览的 src→out 映射、字幕时间码、音效落点会整体错位。
        nr = dict(r)
        nr.update(out0=new_out / FPS, out1=(new_out + n) / FPS)
        new_rows.append(nr)
        segs.append((base_old, base_old + n, new_out, new_out + n))
        old_out += n; new_out += n
        continue
    # 逐段扣
    cur = r0
    for x, y in cuts_in:
        x = max(x, r0); y = min(y, r1)
        if x > cur:
            n = x - cur
            nr = dict(r)
            nr.update(f0=cur, f1=x, src0=cur / FPS, src1=x / FPS,
                      out0=new_out / FPS, out1=(new_out + n) / FPS, n=n)
            new_rows.append(nr)
            segs.append((base_old + (cur - r0), base_old + (x - r0), new_out, new_out + n))
            new_out += n
        lo = max(x, cur); hi = y
        if hi > lo:
            removed.append((base_old + (lo - r0), base_old + (hi - r0)))
        cur = max(cur, y)
    if cur < r1:
        n = r1 - cur
        nr = dict(r)
        nr.update(f0=cur, f1=r1, src0=cur / FPS, src1=r1 / FPS,
                  out0=new_out / FPS, out1=(new_out + n) / FPS, n=n)
        new_rows.append(nr)
        segs.append((base_old + (cur - r0), base_old + (r1 - r0), new_out, new_out + n))
        new_out += n
    old_out += (r1 - r0)         # 老时间轴里这一行始终占满 r1-r0 帧

new_total = new_out / FPS
cuts['rows'] = new_rows
cuts['total'] = round(new_total, 3)
cuts['nframes'] = new_out
# 分组成片起止（重建）
gg = {}
for r in new_rows:
    g = r.get('gid', -1)
    if g < 0:
        continue
    if g not in gg:
        gg[g] = {'i': g, 'out0': r['out0'], 'out1': r['out1']}
    else:
        gg[g]['out0'] = min(gg[g]['out0'], r['out0'])
        gg[g]['out1'] = max(gg[g]['out1'], r['out1'])
# 整组被删完的也要留在列表里（下游 mkdocs / mkaudio 是按序号对齐的，少一个就全错位）
base_gids = [g['i'] for g in cuts.get('groups', [])]
out_groups = []
for i in base_gids:
    if i in gg:
        out_groups.append(gg[i])
    else:
        out_groups.append({'i': i, 'out0': 0.0, 'out1': 0.0, 'dead': 1})
for i in sorted(gg):
    if i not in base_gids:
        out_groups.append(gg[i])
cuts['groups'] = out_groups
save('cuts.json', cuts)


# ============ 时间映射 ============
def build_map(segs):
    """oldOut 帧 -> newOut 帧"""
    def o2n(o):
        o = fr(o)
        for a, b, c, d in segs:
            if a <= o < b:
                return c + (o - a)
        # 落在被删掉的区间里 -> 夹到该区间起点（跟浏览器那套完全一样）
        for a, b in removed:
            if a <= o < b:
                sh = 0
                for x, y in removed:
                    if y <= a:
                        sh += y - x
                return a - sh
        for a, b, c, d in segs:
            if o == b:
                return d
        return segs[-1][3] if segs else o
    return o2n


o2n = build_map(segs)
OLD_TOTAL_F = old_out


def map_time(t, mode='clamp'):
    """成片时间（秒）-> 新的成片时间（秒）"""
    f = t * FPS
    return o2n(f) / FPS


# ---- 平移 timeline.json ----
if tl:
    for g in tl.get('groups', []):
        g0 = map_time(g['t0']); g1 = map_time(g['t1'])
        if g1 - g0 < 0.06:
            # 整段落在删除区间里 -> 标记为 dead（保留在列表里，下游按序号对齐的脚本才不会错位）
            print('  组 %s 整段落在删除区间里 -> 标记 dead' % g['id'])
            g['dead'] = 1
            g['t0'] = round(g0, 4); g['t1'] = round(g0, 4)
            for it in g.get('items', []):
                it['t0'] = round(g0, 4); it['t1'] = round(g0, 4)
            continue
        g['t0'] = round(g0, 4); g['t1'] = round(g1, 4)
        for it in g.get('items', []):
            it['t0'] = round(map_time(it['t0']), 4)
            it['t1'] = round(map_time(it['t1']), 4)
    for f in tl.get('fx', []):
        f['t0'] = round(map_time(f['t0']), 4)
        f['t1'] = round(map_time(f['t1']), 4)
        for k in f.get('k', []):
            k['t'] = round(map_time(k['t']), 4)
    tl['meta']['total'] = round(new_total, 3)
    tl['meta']['nframes'] = new_out
    save('timeline.json', tl)

# ---- 滤镜 ----
parts = []
labels = []
for i, r in enumerate(new_rows):
    parts.append("[0:v]trim=start_frame=%d:end_frame=%d,setpts=PTS-STARTPTS,scale=1080:1920[v%d]"
                 % (r['f0'], r['f1'], i))
    parts.append("[0:a]atrim=start=%.4f:end=%.4f,asetpts=PTS-STARTPTS[a%d]"
                 % (r['src0'], r['src1'], i))
    labels.append("[v%d][a%d]" % (i, i))
fc = ";".join(parts) + ";" + "".join(labels) + "concat=n=%d:v=1:a=1[v][a]" % len(new_rows)
open(os.path.join(ROOT, 'cut.filter'), 'w').write(fc)

if args.fast:
    write_fast_filter(segs)

print('新成片：%.3fs  %d 帧（原 %.3fs / %d 帧，剪掉 %.3fs）'
      % (new_total, new_out, orig_frames / FPS, orig_frames, (orig_frames - new_out) / FPS))
print('行数 %d -> %d' % (len(rows), len(new_rows)))
