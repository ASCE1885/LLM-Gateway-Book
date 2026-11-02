"""第 11 讲：固定并发槽位的教学模拟，不是 GPU 推理引擎基准。

请求在 [0, duration) 到达，warmup 前的请求参与竞争但不计入分位数。
停止到达后排空全部请求；排空超限直接失败，不发布截断的 P99。
详见同目录 README.md。仅使用 Python 标准库。
"""
import argparse
from collections import deque
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import random
import statistics

POLICIES = ['rr', 'weighted_rr', 'random', 'least_req', 'p2c',
            'initial_tok', 'remaining_tok', 'remaining_tok_oracle',
            'least_req_stale', 'p2c_stale']
SCENARIOS = [('homo', [1, 1, 1, 1], 3.3), ('hetero', [1, 1, 1, 0.6], 2.9)]
DT = 0.01
SNAPSHOT_SECONDS = 2.0
PREFILL_SECONDS_PER_TOKEN = 0.00015


def workload(seed, lam, duration):
    """预生成同一请求集；估计值来自真实长度乘噪声，只是合成预测器。"""
    rnd = random.Random(seed)
    reqs, t = [], rnd.expovariate(lam)
    while t < duration:
        out = min(4000, int(rnd.lognormvariate(math.log(200), 1.1)) + 1)
        prompt = min(16000, int(rnd.lognormvariate(math.log(1000), 0.8)) + 1)
        est = out * rnd.lognormvariate(0, 0.6)
        reqs.append((t, prompt, out, est))
        t += rnd.expovariate(lam)
    return reqs


def fingerprint(reqs):
    return hashlib.sha256(json.dumps(reqs, separators=(',', ':')).encode()).hexdigest()


def output_load(requests, policy):
    """三种只计输出的负载指标；均不包含待处理的提示词。"""
    if policy == 'initial_tok':
        return sum(r['est'] for r in requests)
    if policy == 'remaining_tok':
        # 低估时保留至少一个 Token，避免把仍在运行的请求当成零负载。
        return sum(max(1.0, r['est'] - (r['out'] - r['rem'])) for r in requests)
    if policy == 'remaining_tok_oracle':
        return sum(r['rem'] for r in requests)
    raise ValueError(policy)


def quantile(values, p):
    """延续旧版的 floor(p*(n-1)) 次序统计量；空样本返回 None。"""
    return values[int(p * (len(values) - 1))] if values else None


def run(policy, speeds, reqs, duration, seed, B=16, warmup=60, max_drain=3600):
    if policy not in POLICIES or not speeds or min(speeds) <= 0 or B < 1:
        raise ValueError('策略、速度或并发上限无效')
    if not 0 <= warmup < duration or max_drain < 0:
        raise ValueError('需要 0 <= warmup < duration，max_drain >= 0')
    if any(not 0 <= r[0] < duration or r[1] < 1 or r[2] < 1 or r[3] <= 0 for r in reqs):
        raise ValueError('请求必须位于到达窗口内，长度和估计值为正')
    if any(a[0] > b[0] for a, b in zip(reqs, reqs[1:])):
        raise ValueError('请求必须按到达时间排序')
    rnd = random.Random(seed + 10007)
    n_backends = len(speeds)
    active = [[] for _ in speeds]
    queues = [deque() for _ in speeds]
    snap = [0] * n_backends
    current_weights = [0.0] * n_backends
    assigned = [0] * n_backends
    rr = tick = nxt = completed = 0
    ttfts, waits = [], []
    horizon = None
    pending = 0
    while tick * DT < duration or pending or nxt < len(reqs):
        t = tick * DT
        if t >= duration and horizon is None:
            horizon = {
                'pending_total': pending + len(reqs) - nxt,
                'eligible_without_first_token': sum(
                    r['first'] is None and r['arr'] >= warmup
                    for group in active + queues for r in group
                ) + sum(r[0] >= warmup for r in reqs[nxt:]),
            }
        if t > duration + max_drain:
            raise RuntimeError(f'排空超限：{policy}, pending={pending}; 不生成截断统计')
        if tick % round(SNAPSHOT_SECONDS / DT) == 0:
            snap = [len(active[i]) + len(queues[i]) for i in range(n_backends)]
        while nxt < len(reqs) and reqs[nxt][0] <= t:
            arr, prompt, out, est = reqs[nxt]
            nxt += 1
            load = lambda i: len(active[i]) + len(queues[i])
            if policy == 'rr':
                k = rr % n_backends
                rr += 1
            elif policy == 'weighted_rr':
                current_weights = [v + w for v, w in zip(current_weights, speeds)]
                k = max(range(n_backends), key=lambda i: current_weights[i])
                current_weights[k] -= sum(speeds)
            elif policy == 'random':
                k = rnd.randrange(n_backends)
            elif policy in ('p2c', 'p2c_stale'):
                choices = rnd.sample(range(n_backends), min(2, n_backends))
                metric = load if policy == 'p2c' else lambda i: snap[i]
                k = min(choices, key=metric)
            else:
                if policy == 'least_req':
                    metric = load
                elif policy == 'least_req_stale':
                    metric = lambda i: snap[i]
                else:
                    metric = lambda i: output_load(active[i] + list(queues[i]), policy) / speeds[i]
                k = min(range(n_backends), key=lambda i: (metric(i), rnd.random()))
            queues[k].append({'arr': arr, 'prompt': prompt, 'out': out,
                              'rem': float(out), 'est': est, 'first': None})
            assigned[k] += 1
            pending += 1
        for i in range(n_backends):
            while queues[i] and len(active[i]) < B:
                r = queues[i].popleft()
                r['start'] = t
                r['pf_end'] = t + r['prompt'] * PREFILL_SECONDS_PER_TOKEN / speeds[i]
                active[i].append(r)
            batch = len(active[i])
            if not batch:
                continue
            # 每个运行请求的解码速率；预填充占槽且影响 batch，但没有共享计算预算。
            tokens = DT * speeds[i] / (0.02 + 0.0015 * batch)
            done = []
            for r in active[i]:
                if r['first'] is None:
                    if t < r['pf_end']:
                        continue
                    r['first'] = r['pf_end']
                    r['rem'] -= 1  # 首 Token 已在预填充结束时产生。
                    if r['arr'] >= warmup:
                        ttfts.append(r['first'] - r['arr'])
                        waits.append(r['start'] - r['arr'])
                else:
                    r['rem'] -= tokens
                if r['rem'] <= 0:
                    done.append(r)
            for r in done:
                active[i].remove(r)
                completed += 1
                pending -= 1
        tick += 1
    # duration 恰好落在空系统终点时，也记录观察窗边界。
    horizon = horizon or {'pending_total': 0, 'eligible_without_first_token': 0}
    expected = sum(r[0] >= warmup for r in reqs)
    if completed != len(reqs) or len(ttfts) != expected:
        raise AssertionError('样本未完整排空')
    ttfts.sort()
    waits.sort()
    return {'p50': quantile(ttfts, .5), 'p90': quantile(ttfts, .9),
            'p99': quantile(ttfts, .99), 'queue_p99': quantile(waits, .99),
            'n': len(ttfts), 'eligible': expected, 'arrived': len(reqs),
            'completed': completed, 'horizon': horizon,
            'drained_at': round(tick * DT, 6), 'assigned': assigned,
            'workload_sha256': fingerprint(reqs)}


def job(args):
    scenario, speeds, lam, policy, seed, duration, warmup, max_drain = args
    result = run(policy, speeds, workload(seed, lam, duration), duration, seed,
                 warmup=warmup, max_drain=max_drain)
    return {'scenario': scenario, 'policy': policy, 'seed': seed, **result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('duration', type=int, nargs='?', default=1800)
    parser.add_argument('seeds', type=int, nargs='?', default=10)
    parser.add_argument('--warmup', type=float, default=60)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--max-drain', type=float, default=3600)
    parser.add_argument('--output', type=Path, default=Path(__file__).with_name('results.json'))
    args = parser.parse_args()
    if args.seeds < 1 or args.workers < 1 or not 0 <= args.warmup < args.duration:
        parser.error('种子数、进程数必须为正，且 0 <= warmup < duration')
    jobs = [(sc, sp, lam, pol, seed, args.duration, args.warmup, args.max_drain)
            for sc, sp, lam in SCENARIOS for pol in POLICIES for seed in range(1, args.seeds + 1)]
    runs = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for row in pool.map(job, jobs):
            runs.append(row)
            if len(runs) % args.seeds == 0:
                print(f"完成 {row['scenario']}/{row['policy']} ({len(runs)}/{len(jobs)})", flush=True)
    summary = {}
    for sc, _, _ in SCENARIOS:
        for pol in POLICIES:
            group = [r for r in runs if r['scenario'] == sc and r['policy'] == pol]
            vals = [r['p99'] for r in group]
            if any(v is None for v in vals):
                raise RuntimeError('评测窗口没有样本；不发布汇总')
            summary[f'{sc}/{pol}'] = {'p99_median': statistics.median(vals),
                'p99_min': min(vals), 'p99_max': max(vals), 'seeds': len(vals)}
            print(f"{sc}/{pol:<24} {statistics.median(vals):8.2f}s [{min(vals):.2f}, {max(vals):.2f}]", flush=True)
    payload = {'schema_version': 2,
        'metadata': {'created_at_utc': datetime.now(timezone.utc).isoformat(),
            'duration_seconds': args.duration, 'warmup_seconds': args.warmup,
            'drain_limit_seconds': args.max_drain, 'seeds': list(range(1, args.seeds + 1)),
            'dt_seconds': DT, 'slots_per_replica': 16, 'snapshot_seconds': SNAPSHOT_SECONDS,
            'scenarios': [{'name': sc, 'speeds': sp, 'arrival_rate': lam} for sc, sp, lam in SCENARIOS],
            'quantile': 'sorted[floor(p*(n-1))]',
            'aggregation': 'median and min/max of per-seed P99; not pooled P99 or confidence interval',
            'workload': {'output_median': 200, 'output_log_sigma': 1.1, 'output_cap': 4000,
                'prompt_median': 1000, 'prompt_log_sigma': .8, 'prompt_cap': 16000,
                'estimate_log_sigma': .6},
            'prefill_seconds_per_token': PREFILL_SECONDS_PER_TOKEN,
            'decode_step_seconds': '(0.02 + 0.0015 * active_count) / speed',
            'python': platform.python_version(),
            'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
        'summary': summary, 'runs': runs}
    # 仅完整完成后替换文件，失败的运行不会覆盖已有结果。
    staging = args.output.with_suffix('.json.tmp')
    staging.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    staging.replace(args.output)


if __name__ == '__main__':
    main()
