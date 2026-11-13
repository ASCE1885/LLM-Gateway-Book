"""第 22 讲：确定性、离线的 OpenTelemetry 记录示例，不是 HTTP 网关。

不请求模型，不解析真实 SSE，不安装自动插桩。事件和 usage 全为合成数据。
SDK 与语义约定分别固定，详见 README。计时使用显式纳秒时间戳，指标单位为秒。
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass

from opentelemetry import trace
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.metrics.view import ExplicitBucketHistogramAggregation, View
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.trace.sampling import ALWAYS_OFF, ALWAYS_ON
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

PREFIX = "gen_ai.client.inference."
DURATION = PREFIX + "duration"
TTFC = PREFIX + "time_to_first_chunk"
CHUNK_GAP = PREFIX + "time_per_output_chunk"
GW_DURATION = "llm_gateway.request.duration"
GW_FIRST_WRITE = "llm_gateway.response.time_to_first_content_write"
ATTEMPT_DURATION = "llm_gateway.upstream.attempt.duration"
ATTEMPT_TTFC = "llm_gateway.upstream.attempt.time_to_first_chunk"
UNKNOWN_USAGE = "llm_gateway.upstream.usage_unknown"
RETRIES = "llm_gateway.upstream.retries"
FALLBACKS = "llm_gateway.upstream.fallbacks"
# 这是教学示例的工作负载桶，不宣称是所有指标共用的官方建议。
LATENCY_BUCKETS = (0.01, 0.025, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4)
INTERVAL_BUCKETS = (0.005, 0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64)
TOKEN_BUCKETS = (16, 64, 256, 1024, 4096, 16384)
BASE_NS = 1_800_000_000_000_000_000


@dataclass(frozen=True)
class Usage:
    """已归一化的提供方报告值（适用时选计费用量）；缓存、推理是子集。"""
    input_tokens: int
    output_tokens: int
    cache_read: int = 0
    reasoning: int = 0

    def __post_init__(self):
        values = (self.input_tokens, self.output_tokens, self.cache_read, self.reasoning)
        if any(type(v) is not int or v < 0 for v in values):
            raise ValueError("usage must contain nonnegative integer counts")
        if self.cache_read > self.input_tokens or self.reasoning > self.output_tokens:
            raise ValueError("usage subset exceeds total")


@dataclass(frozen=True)
class Event:
    """ms 是相对当前尝试开始的时间；content 已由假想适配器判为有效内容。"""
    ms: int
    kind: str
    usage: Usage | None = None
    response_model: str | None = None


@dataclass(frozen=True)
class Operation:
    provider: str
    model: str
    attempts: tuple[tuple[Event, ...], ...]


def scenarios():
    # 三个有效分片，provider usage 报告 24 个输出 Token；不按分片推算。
    def success(model):
        return (Event(50, "role"), Event(300, "content"), Event(320, "write"),
               Event(340, "content"), Event(380, "content"),
               Event(420, "usage", Usage(1200, 24, 800, 6)),
               Event(440, "end", response_model=model))
    limited = (Event(80, "rate_limited"),)
    return {
        "retry": (Operation("example", "model-a", (limited, success("model-a-2026"))),),
        "error": (Operation("example", "model-a", (limited, limited)),),
        "cancel": (Operation("example", "model-a", ((Event(50, "role"),
                    Event(300, "content"), Event(320, "write"), Event(350, "cancel")),)),),
        "fallback": (Operation("example", "model-a", (limited,)),
                     Operation("example-backup", "model-b", (success("model-b-2026"),))),
    }


class Telemetry:
    """每个实验使用独立 provider，不修改进程全局 provider。"""
    def __init__(self, sampled=True):
        resource = Resource.create({"service.name": "llm-gateway-demo"})
        self.exporter = InMemorySpanExporter()
        self.tp = TracerProvider(resource=resource, sampler=ALWAYS_ON if sampled else ALWAYS_OFF)
        self.tp.add_span_processor(SimpleSpanProcessor(self.exporter))
        self.tracer = self.tp.get_tracer("chapter22", "1.0.0")
        self.reader = InMemoryMetricReader()
        views = [View(instrument_name=name,
                      aggregation=ExplicitBucketHistogramAggregation(LATENCY_BUCKETS))
                 for name in (DURATION, TTFC, GW_DURATION, GW_FIRST_WRITE,
                              ATTEMPT_DURATION, ATTEMPT_TTFC)]
        views += [View(instrument_name=CHUNK_GAP,
                       aggregation=ExplicitBucketHistogramAggregation(INTERVAL_BUCKETS))]
        views += [View(instrument_name=PREFIX + "operation." + side,
                       aggregation=ExplicitBucketHistogramAggregation(TOKEN_BUCKETS))
                  for side in ("input_tokens", "output_tokens")]
        self.mp = MeterProvider(resource=resource, metric_readers=[self.reader], views=views)
        meter = self.mp.get_meter("chapter22", "1.0.0")
        self.instruments = {name: meter.create_histogram(name, unit="s") for name in
                            (DURATION, TTFC, CHUNK_GAP, GW_DURATION, GW_FIRST_WRITE,
                             ATTEMPT_DURATION, ATTEMPT_TTFC)}
        for suffix in ("input_tokens", "output_tokens", "cache_read.input_tokens", "reasoning.output_tokens"):
            name = PREFIX + "usage." + suffix
            self.instruments[name] = meter.create_counter(name, unit="{token}")
        for side in ("input_tokens", "output_tokens"):
            name = PREFIX + "operation." + side
            self.instruments[name] = meter.create_histogram(name, unit="{token}")
        for name in (UNKNOWN_USAGE, RETRIES, FALLBACKS):
            self.instruments[name] = meter.create_counter(name, unit="{attempt}")

    def record(self, name, value, attrs, context):
        # 指标记录不依赖 span.is_recording() 或 Trace 采样结果。
        instrument = self.instruments[name]
        fn = getattr(instrument, "record", None) or instrument.add
        fn(value, attributes=attrs, context=context)

    def points(self, name):
        return [p for r in self.reader.get_metrics_data().resource_metrics
                for scope in r.scope_metrics for m in scope.metrics if m.name == name
                for p in m.data.data_points]

    def close(self):
        self.mp.shutdown()
        self.tp.shutdown()


@dataclass
class Result:
    telemetry: Telemetry
    outcome: str
    milestones: dict[str, int]
    outgoing_headers: list[dict[str, str]]


def validate(operations):
    if not operations or any(not op.attempts for op in operations):
        raise ValueError("at least one operation and attempt are required")
    allowed = {"role", "empty", "heartbeat", "content", "write", "usage", "end",
               "rate_limited", "stream_error", "cancel"}
    terminal = {"end", "rate_limited", "stream_error", "cancel"}
    for op in operations:
        for events in op.attempts:
            if not events or events[-1].kind not in terminal:
                raise ValueError("each attempt needs a terminal event")
            if any(e.kind not in allowed or e.ms < 0 for e in events):
                raise ValueError("invalid event")
            if any(a.ms > b.ms for a, b in zip(events, events[1:])):
                raise ValueError("events must be ordered")
            if any(e.kind in terminal for e in events[:-1]):
                raise ValueError("terminal event must be last")
            if sum(e.kind == "usage" for e in events) > 1:
                raise ValueError("fixture accepts one final usage report per attempt")
            if any((e.kind == "usage") != (e.usage is not None) for e in events):
                raise ValueError("usage payload must match usage event")
            if any(e.kind == "write" and not any(p.kind == "content" for p in events[:i])
                   for i, e in enumerate(events)):
                raise ValueError("content write must follow content receipt")


def run(operations=None, *, sampled=True, incoming=None):
    """模拟串行重试 / Fallback；任何内容到达或取消后都不再重放。

    incoming 仅接收测试用可信上下文；不是外部请求头的安全过滤实现。
    429/失败缺少 usage 时记录未知次数，不假定没有计费。
    """
    operations = scenarios()["retry"] if operations is None else operations
    validate(operations)
    t = Telemetry(sampled)
    clock = 0
    milestones = {}
    outgoing = []
    ns = lambda ms: BASE_NS + ms * 1_000_000
    propagator = TraceContextTextMapPropagator()
    parent = propagator.extract(incoming or {})
    root = t.tracer.start_span("POST /v1/chat/completions", context=parent, kind=SpanKind.SERVER,
                              attributes={"http.request.method": "POST", "http.route": "/v1/chat/completions"},
                              start_time=ns(clock))
    root_ctx = trace.set_span_in_context(root, parent)
    guard = t.tracer.start_span("guardrail input", context=root_ctx, start_time=ns(clock))
    clock = 30
    guard.end(end_time=ns(clock))
    outcome = "error"
    first_write = None
    for op_index, op in enumerate(operations):
        attrs = {"gen_ai.operation.name": "chat", "gen_ai.provider.name": op.provider,
                 "gen_ai.request.model": op.model}
        if op_index:
            t.record(FALLBACKS, 1, {"reason": "upstream_failure"}, root_ctx)
        logical_start = clock
        logical = t.tracer.start_span("chat " + op.model, context=root_ctx, kind=SpanKind.CLIENT,
                                      attributes={**attrs, "gen_ai.request.stream": True}, start_time=ns(clock))
        logical_ctx = trace.set_span_in_context(logical, root_ctx)
        first_content = previous_content = None
        logical_usage = []
        unknown_attempts = 0
        outcome = "error"
        error_type = "rate_limited"
        response_model = None
        for attempt_index, events in enumerate(op.attempts):
            if attempt_index:
                t.record(RETRIES, 1, {"reason": "rate_limited"}, logical_ctx)
                delay = t.tracer.start_span("retry backoff", context=logical_ctx, start_time=ns(clock))
                clock += 50
                delay.end(end_time=ns(clock))
            attempt_start = clock
            http = t.tracer.start_span("POST", context=logical_ctx, kind=SpanKind.CLIENT,
                       attributes={"http.request.method": "POST", "server.address": "model.invalid",
                                   "server.port": 443, "url.full": "https://model.invalid/v1/chat/completions",
                                   "http.request.resend_count": attempt_index}, start_time=ns(clock))
            http_ctx = trace.set_span_in_context(http, logical_ctx)
            carrier = {}
            propagator.inject(carrier, context=http_ctx)
            outgoing.append(carrier)
            attempt_first = None
            usage = None
            for event in events:
                clock = attempt_start + event.ms
                if event.kind == "content":
                    if attempt_first is None:
                        attempt_first = clock
                        t.record(ATTEMPT_TTFC, (clock-attempt_start)/1000, attrs, http_ctx)
                    if first_content is None:
                        first_content = clock
                        milestones.setdefault("first_content_received", clock)
                        t.record(TTFC, (clock-logical_start)/1000, attrs, logical_ctx)
                        logical.set_attribute("gen_ai.response.time_to_first_chunk", (clock-logical_start)/1000)
                        logical.add_event("llm_gateway.first_content_received", timestamp=ns(clock))
                    if previous_content is not None:
                        t.record(CHUNK_GAP, (clock-previous_content)/1000, attrs, logical_ctx)
                    previous_content = clock
                elif event.kind == "write" and first_write is None:
                    first_write = clock
                    milestones["first_content_written"] = clock
                    t.record(GW_FIRST_WRITE, clock/1000, {"route": "chat"}, root_ctx)
                    root.add_event("llm_gateway.first_content_written", timestamp=ns(clock))
                elif event.kind == "usage":
                    usage = event.usage
                elif event.kind == "end":
                    outcome = "success"
                    response_model = event.response_model
                    http.set_attribute("http.response.status_code", 200)
                elif event.kind == "cancel":
                    outcome = "cancelled"
                    # 此示例为调用方主动取消：保留 UNSET，不伪造 CANCELLED 状态。
                    http.set_attribute("llm_gateway.termination.reason", "client_cancelled")
                elif event.kind in ("rate_limited", "stream_error"):
                    outcome, error_type = "error", event.kind
                    http.set_attribute("error.type", "429" if event.kind == "rate_limited" else "stream_error")
                    if event.kind == "rate_limited":
                        http.set_attribute("http.response.status_code", 429)
                    http.set_status(Status(StatusCode.ERROR))
            if usage is None:
                unknown_attempts += 1
                t.record(UNKNOWN_USAGE, 1, {**attrs, "outcome": outcome}, http_ctx)
            else:
                logical_usage.append(usage)
                # 只累计提供方报告的已知用量，不把未知尝试补成零。
                values = {"input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens,
                          "cache_read.input_tokens": usage.cache_read, "reasoning.output_tokens": usage.reasoning}
                for suffix, value in values.items():
                    # 模态无法从本例的合成 usage 判断，明确填 unknown；推理子类不拆模态。
                    token_attrs = attrs if suffix.startswith("reasoning.") else {**attrs, "gen_ai.token.modality": "unknown"}
                    if value > 0:
                        t.record(PREFIX + "usage." + suffix, value, token_attrs, logical_ctx)
            t.record(ATTEMPT_DURATION, (clock-attempt_start)/1000,
                     {**attrs, "outcome": outcome}, http_ctx)
            http.end(end_time=ns(clock))
            if outcome != "error" or first_content is not None or error_type != "rate_limited":
                break
        logical.set_attribute("llm_gateway.usage.unknown_attempts", unknown_attempts)
        logical.set_attribute("llm_gateway.usage.status", "reported_partial" if logical_usage and unknown_attempts
                              else "reported" if logical_usage else "unknown")
        if logical_usage:
            totals = {"input_tokens": sum(u.input_tokens for u in logical_usage),
                      "output_tokens": sum(u.output_tokens for u in logical_usage),
                      "cache_read.input_tokens": sum(u.cache_read for u in logical_usage),
                      "reasoning.output_tokens": sum(u.reasoning for u in logical_usage)}
            # 不把部分已知用量包装成整个逻辑操作的完整分布 / Span 总量。
            if not unknown_attempts:
                for suffix, value in totals.items():
                    logical.set_attribute("gen_ai.usage." + suffix, value)
                for side in ("input_tokens", "output_tokens"):
                    t.record(PREFIX + "operation." + side, totals[side], attrs, logical_ctx)
        if outcome == "success":
            if response_model is not None:
                logical.set_attribute("gen_ai.response.model", response_model)
            logical.set_attribute("gen_ai.response.finish_reasons", ["stop"])
        elif outcome == "error":
            logical.set_attribute("error.type", error_type)
            logical.set_status(Status(StatusCode.ERROR))
        else:
            logical.set_attribute("llm_gateway.termination.reason", "client_cancelled")
        t.record(DURATION, (clock-logical_start)/1000,
                 {**attrs, **({"error.type": error_type} if outcome == "error" else {}),
                  **({"gen_ai.response.model": response_model} if response_model else {})}, logical_ctx)
        logical.end(end_time=ns(clock))
        milestones["upstream_finished"] = clock
        if outcome != "error" or first_content is not None:
            break
    if outcome == "success":
        clock += 20  # 模拟下游尾部交付；不把它计入上游逻辑操作。
        root.set_attribute("http.response.status_code", 200)
    elif outcome == "error":
        root.set_attribute("error.type", error_type)
        root.set_status(Status(StatusCode.ERROR))
    else:
        root.set_attribute("llm_gateway.termination.reason", "client_cancelled")
    root.set_attribute("llm_gateway.outcome", outcome)
    t.record(GW_DURATION, clock/1000, {"route": "chat", "outcome": outcome}, root_ctx)
    root.end(end_time=ns(clock))
    milestones["gateway_finished"] = clock
    return Result(t, outcome, milestones, outgoing)


def report(result):
    spans = sorted(result.telemetry.exporter.get_finished_spans(), key=lambda s: (s.start_time, -s.end_time))
    parents = {s.context.span_id: s for s in spans}
    print("== Trace（相对入站起点，ms；全部为合成数据）")
    for span in spans:
        depth, parent = 0, span.parent
        while parent is not None and parent.span_id in parents:
            depth, parent = depth + 1, parents[parent.span_id].parent
        print(f"{'  '*depth}{span.name} [{span.kind.name}] "
              f"{(span.start_time-BASE_NS)//1_000_000}–{(span.end_time-BASE_NS)//1_000_000} "
              f"status={span.status.status_code.name}")
    print("== Metric（只显示实测样本；未记录不是零）")
    for name in (DURATION, TTFC, ATTEMPT_TTFC, GW_FIRST_WRITE, CHUNK_GAP,
                 PREFIX + "usage.input_tokens", PREFIX + "usage.output_tokens", UNKNOWN_USAGE):
        for point in result.telemetry.points(name):
            if hasattr(point, "count"):
                value = f"count={point.count}, sum={point.sum:.3f}s"
            else:
                value = f"value={point.value}"
            print(f"{name}: {value}; {dict(point.attributes)}")
    print("== Milestones（ms）")
    for key, value in result.milestones.items():
        print(f"{key}={value}")
    print("已知用量按提供方报告累计；缺失 usage 的尝试另计未知，不能据此完成费用对账。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", choices=scenarios(), default="retry")
    args = parser.parse_args()
    result = run(scenarios()[args.scenario])
    try:
        report(result)
    finally:
        result.telemetry.close()
