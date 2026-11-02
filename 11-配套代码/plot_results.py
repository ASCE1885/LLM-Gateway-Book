"""从 results.json 生成第 11 讲实验图；需要 Matplotlib 和中文字体。"""
import argparse
import json
from pathlib import Path
import re

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.lines import Line2D
from matplotlib.ticker import FixedLocator, FixedFormatter, NullLocator
from PIL import Image

ORDER = [('rr', '等权轮询'), ('weighted_rr', '容量加权轮询'), ('random', '等概率随机'),
         ('least_req', '最少在途'), ('p2c', 'P2C'),
         ('initial_tok', '初始输出估计'), ('remaining_tok', '剩余输出估计'),
         ('remaining_tok_oracle', '真实剩余输出*'),
         ('least_req_stale', '最少在途（旧）'), ('p2c_stale', 'P2C（旧）')]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font', default='Hiragino Sans GB')
    parser.add_argument('--preview-dir', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    doc = json.loads((root/'11-配套代码/results.json').read_text())
    assert doc['schema_version'] == 2
    assert doc['metadata']['seeds'] == list(range(1, 11))
    assert all(r['n'] == r['eligible'] and r['completed'] == r['arrived'] for r in doc['runs'])
    font_manager.findfont(args.font, fallback_to_default=False)
    plt.rcParams.update({'font.family': args.font, 'font.size': 9,
                         'svg.fonttype': 'none', 'axes.unicode_minus': False})
    fig = plt.figure(figsize=(150/25.4, 190/25.4), facecolor='white')
    fig.text(.04, .967, '不同策略的 P99 首 Token 延迟', fontsize=12, weight='bold', color='#203348')
    fig.text(.04, .932, '固定槽位教学模拟 · 4 个副本 · 各场景 10 个种子', color='#526477')
    handles = [Line2D([], [], color='#2E638C', marker='o', markersize=4.5, linewidth=1.3),
               Line2D([], [], color='#996B2E', marker='s', markerfacecolor='white', markersize=4.5,
                      linewidth=1.3, linestyle='--')]
    fig.legend(handles, ['同构', '异构：一个副本速度为 60%'], frameon=False,
               loc='upper left', bbox_to_anchor=(.035, .912), ncol=2, handlelength=1.5,
               columnspacing=1.3, borderaxespad=0)
    fig.text(.845, .866, '同构 / 秒', ha='right', color='#2E638C')
    fig.text(.975, .866, '异构 / 秒', ha='right', color='#996B2E')
    ax = fig.add_axes([.242, .23, .495, .612])
    ax.set_xscale('log')
    ax.set_xlim(.7, 1000)
    ax.set_ylim(-.6, 9.6)
    ax.xaxis.set_major_locator(FixedLocator([1, 10, 100, 1000]))
    ax.xaxis.set_major_formatter(FixedFormatter(['1', '10', '100', '1000']))
    ax.xaxis.set_minor_locator(NullLocator())
    ax.set_yticks(list(range(10)), [label for _, label in reversed(ORDER)])
    ax.tick_params(axis='y', length=0, pad=7, labelsize=9)
    ax.tick_params(axis='x', length=3, color='#A7B4C2', labelsize=9)
    ax.grid(axis='x', color='#DFE5EB', linewidth=.7)
    ax.set_axisbelow(True)
    for name, spine in ax.spines.items():
        spine.set_visible(name == 'bottom')
        spine.set_color('#A7B4C2')
        spine.set_linewidth(.7)
    for row, (policy, _) in enumerate(ORDER):
        y = 9-row
        for sc, offset, color, marker, filled, style in [
            ('homo', .14, '#2E638C', 'o', True, '-'),
            ('hetero', -.14, '#996B2E', 's', False, '--')]:
            d = doc['summary'][f'{sc}/{policy}']
            ax.plot([d['p99_min'], d['p99_max']], [y+offset]*2, color=color,
                    alpha=.65, linewidth=1.3, linestyle=style, solid_capstyle='round')
            ax.plot(d['p99_median'], y+offset, marker=marker, markersize=4.5,
                    markeredgewidth=.9, markerfacecolor=color if filled else 'white',
                    markeredgecolor=color, linestyle='none')
            fy = .23 + .612 * ((y+.6)/10.2)
            fig.text(.845 if sc == 'homo' else .975, fy, f"{d['p99_median']:.2f}",
                     ha='right', va='center', fontsize=9, color='#203348')
    ax.set_xlabel('P99 TTFT / 秒（对数刻度）', labelpad=8, fontsize=9, color='#526477')
    notes = [
        '点：各次 P99 的中位数；横线：最小—最大值，非置信区间。',
        '（旧）：每 2 秒刷新快照；*：使用未来真实长度，仅作对照。',
        '到达窗口 1800 秒，预热 60 秒；停止到达后排空全部请求。',
        '每副本 16 槽位；未模拟共享预填充算力、KV 和网络。',
        '结果说明此模型内的差异，不代表真实推理引擎排名。',
    ]
    for i, note in enumerate(notes):
        fig.text(.04, .129-i*.0235, note, fontsize=9, color='#526477')
    fig.canvas.draw()
    # 检查可见文字之间的重叠及画布溢出；保存几何信息用于审阅。
    renderer = fig.canvas.get_renderer()
    items = []
    for text in fig.findobj(match=matplotlib.text.Text):
        if text.get_visible() and text.get_text():
            box = text.get_window_extent(renderer)
            items.append({'text': text.get_text(), 'bbox': list(box.bounds), 'size_pt': text.get_fontsize()})
    overlaps = []
    for i, a in enumerate(items):
        x,y,w,h=a['bbox']
        if x < -1 or y < -1 or x+w > fig.bbox.width+1 or y+h > fig.bbox.height+1:
            overlaps.append(['outside', a['text']])
        for b in items[i+1:]:
            xx,yy,ww,hh=b['bbox']
            if min(x+w,xx+ww)-max(x,xx)>1 and min(y+h,yy+hh)-max(y,yy)>1:
                overlaps.append([a['text'],b['text']])
    if overlaps:
        raise RuntimeError(f'Text geometry: {overlaps}')
    name = '11-负载均衡模拟'
    svg = root/'配图/源文件'/f'{name}.svg'
    png = root/'配图'/f'{name}.png'
    fig.savefig(svg, format='svg', metadata={'Title':'不同策略的 P99 首 Token 延迟',
        'Description':'Source: 11-配套代码/results.json schema 2; median and range of ten per-seed P99 values, not a confidence interval.'})
    content = svg.read_text()
    content = re.sub(r'<svg ([^>]*?)width="[^"]+" height="[^"]+"', r'<svg \1width="150mm" height="190mm"', content, count=1)
    svg.write_text(content)
    fig.savefig(png, dpi=300, facecolor='white')
    with Image.open(png) as im:
        resized = im.resize((1772, round(1772*190/150)), Image.Resampling.LANCZOS)
        resized.save(png, dpi=(300,300))
        if args.preview_dir:
            args.preview_dir.mkdir(parents=True, exist_ok=True)
            preview=resized.resize((1050,1330), Image.Resampling.LANCZOS)
            preview.save(args.preview_dir/f'{name}-color.png')
            preview.convert('L').save(args.preview_dir/f'{name}-gray.png')
            (args.preview_dir/'chart-text-geometry.json').write_text(json.dumps(items,ensure_ascii=False,indent=2))
    print(f'Chart saved: {png}; font >= 9 pt; text geometry passed')
    plt.close(fig)


if __name__ == '__main__':
    main()
