"""验证导出的真实 OTel Span / Metric；不访问网络或提供方。"""
import unittest
from opentelemetry.trace import SpanKind, StatusCode
import gateway_telemetry as g


class TelemetryTests(unittest.TestCase):
    def run_case(self, *args, **kwargs):
        result = g.run(*args, **kwargs)
        self.addCleanup(result.telemetry.close)
        return result

    def total(self, result, name):
        return sum(p.sum if hasattr(p, "sum") else p.value
                   for p in result.telemetry.points(name))

    def test_retry_timing_and_parentage(self):
        r = self.run_case()
        self.assertEqual(r.milestones, {"first_content_received": 460, "first_content_written": 480,
                                       "upstream_finished": 600, "gateway_finished": 620})
        for name, seconds in [(g.DURATION, .570), (g.TTFC, .430), (g.ATTEMPT_TTFC, .300),
                              (g.GW_FIRST_WRITE, .480), (g.GW_DURATION, .620)]:
            self.assertAlmostEqual(self.total(r, name), seconds)
        spans = r.telemetry.exporter.get_finished_spans()
        root = next(s for s in spans if s.kind == SpanKind.SERVER)
        logical = next(s for s in spans if s.name == "chat model-a")
        attempts = sorted((s for s in spans if s.name == "POST"), key=lambda s: s.start_time)
        self.assertEqual(logical.parent.span_id, root.context.span_id)
        self.assertTrue(all(s.parent.span_id == logical.context.span_id for s in attempts))
        self.assertEqual([s.attributes["http.request.resend_count"] for s in attempts], [0, 1])
        self.assertEqual(attempts[0].status.status_code, StatusCode.ERROR)
        self.assertEqual(logical.status.status_code, StatusCode.UNSET)
        self.assertTrue(logical.attributes["gen_ai.request.stream"])
        self.assertEqual(logical.attributes["gen_ai.response.model"], "model-a-2026")
        self.assertAlmostEqual(logical.attributes["gen_ai.response.time_to_first_chunk"], .430)
        self.assertEqual(len(r.telemetry.points(g.DURATION)), 1)
        self.assertEqual(self.total(r, g.RETRIES), 1)

    def test_tokens_are_provider_usage_not_chunks(self):
        r = self.run_case()
        self.assertEqual(self.total(r, g.PREFIX + "usage.output_tokens"), 24)
        self.assertEqual(self.total(r, g.PREFIX + "usage.reasoning.output_tokens"), 6)
        self.assertEqual(self.total(r, g.PREFIX + "usage.input_tokens"), 1200)
        self.assertEqual(self.total(r, g.PREFIX + "usage.cache_read.input_tokens"), 800)
        gap = r.telemetry.points(g.CHUNK_GAP)[0]
        self.assertEqual(gap.count, 2)  # 三个有效内容分片，而非 24 个分片。
        self.assertAlmostEqual(gap.sum, .080)
        self.assertEqual(self.total(r, g.UNKNOWN_USAGE), 1)  # 失败尝试缺少报告。
        logical = next(s for s in r.telemetry.exporter.get_finished_spans() if s.name == "chat model-a")
        self.assertEqual(logical.attributes["llm_gateway.usage.status"], "reported_partial")
        self.assertNotIn("gen_ai.usage.input_tokens", logical.attributes)
        self.assertEqual(r.telemetry.points(g.PREFIX + "operation.input_tokens"), [])

    def test_all_failures_do_not_record_nonexistent_first_content(self):
        r = self.run_case(g.scenarios()["error"])
        self.assertEqual(r.outcome, "error")
        for name in (g.TTFC, g.ATTEMPT_TTFC, g.GW_FIRST_WRITE, g.PREFIX + "usage.output_tokens"):
            self.assertEqual(r.telemetry.points(name), [])
        self.assertEqual(self.total(r, g.UNKNOWN_USAGE), 2)
        self.assertEqual(self.total(r, g.RETRIES), 1)
        root = next(s for s in r.telemetry.exporter.get_finished_spans() if s.kind == SpanKind.SERVER)
        self.assertEqual(root.status.status_code, StatusCode.ERROR)
        self.assertNotIn("gen_ai.response.model", root.attributes)

    def test_caller_cancellation_without_usage(self):
        r = self.run_case(g.scenarios()["cancel"])
        self.assertEqual(r.outcome, "cancelled")
        self.assertEqual(self.total(r, g.UNKNOWN_USAGE), 1)
        self.assertEqual(r.telemetry.points(g.PREFIX + "usage.output_tokens"), [])
        logical = next(s for s in r.telemetry.exporter.get_finished_spans() if s.name == "chat model-a")
        self.assertEqual(logical.status.status_code, StatusCode.UNSET)
        self.assertEqual(logical.attributes["llm_gateway.termination.reason"], "client_cancelled")
        self.assertNotIn("gen_ai.response.finish_reasons", logical.attributes)

    def test_fallback_separates_provider_operations(self):
        r = self.run_case(g.scenarios()["fallback"])
        self.assertEqual(r.outcome, "success")
        points = r.telemetry.points(g.DURATION)
        self.assertEqual({p.attributes["gen_ai.request.model"] for p in points}, {"model-a", "model-b"})
        self.assertEqual(self.total(r, g.FALLBACKS), 1)
        self.assertEqual(r.telemetry.points(g.RETRIES), [])
        usage = r.telemetry.points(g.PREFIX + "usage.output_tokens")
        self.assertEqual(len(usage), 1)
        self.assertEqual(usage[0].attributes["gen_ai.provider.name"], "example-backup")
        self.assertEqual(usage[0].value, 24)

    def test_metrics_survive_disabled_trace_sampling(self):
        r = self.run_case(sampled=False)
        self.assertEqual(r.telemetry.exporter.get_finished_spans(), ())
        self.assertAlmostEqual(self.total(r, g.TTFC), .430)
        self.assertEqual(self.total(r, g.PREFIX + "usage.output_tokens"), 24)

    def test_context_is_extracted_and_current_child_injected(self):
        trace_id = "0123456789abcdef0123456789abcdef"
        old_parent = "1111111111111111"
        r = self.run_case(incoming={"traceparent": f"00-{trace_id}-{old_parent}-01"})
        spans = r.telemetry.exporter.get_finished_spans()
        root = next(s for s in spans if s.kind == SpanKind.SERVER)
        self.assertEqual(root.parent.span_id, int(old_parent, 16))
        attempts = sorted((s for s in spans if s.name == "POST"), key=lambda s: s.start_time)
        for headers, attempt in zip(r.outgoing_headers, attempts):
            fields = headers["traceparent"].split("-")
            self.assertEqual(fields[1], trace_id)
            self.assertEqual(fields[2], f"{attempt.context.span_id:016x}")
            self.assertNotEqual(fields[2], old_parent)

    def test_empty_role_and_heartbeat_are_not_content(self):
        events = (g.Event(5, "role"), g.Event(10, "empty"), g.Event(15, "heartbeat"),
                  g.Event(20, "content"), g.Event(25, "write"),
                  g.Event(30, "usage", g.Usage(100, 8)), g.Event(35, "end"))
        r = self.run_case((g.Operation("example", "model-a", (events,)),))
        self.assertAlmostEqual(self.total(r, g.TTFC), .020)
        self.assertEqual(r.telemetry.points(g.CHUNK_GAP), [])
        self.assertEqual(self.total(r, g.PREFIX + "usage.output_tokens"), 8)
        self.assertEqual(self.total(r, g.PREFIX + "operation.output_tokens"), 8)
        logical = next(s for s in r.telemetry.exporter.get_finished_spans() if s.name == "chat model-a")
        self.assertNotIn("gen_ai.response.model", logical.attributes)

    def test_positive_contributions_and_unknown_modality(self):
        events = (g.Event(10, "usage", g.Usage(100, 0)), g.Event(20, "end"))
        r = self.run_case((g.Operation("example", "model-a", (events,)),))
        point = r.telemetry.points(g.PREFIX + "usage.input_tokens")[0]
        self.assertEqual(point.attributes["gen_ai.token.modality"], "unknown")
        for suffix in ("output_tokens", "cache_read.input_tokens", "reasoning.output_tokens"):
            self.assertEqual(r.telemetry.points(g.PREFIX + "usage." + suffix), [])
        default = self.run_case()
        reasoning = default.telemetry.points(g.PREFIX + "usage.reasoning.output_tokens")[0]
        self.assertNotIn("gen_ai.token.modality", reasoning.attributes)

    def test_midstream_error_does_not_replay_or_invent_usage(self):
        events = (g.Event(20, "content"), g.Event(25, "write"), g.Event(30, "stream_error"))
        forbidden = (g.Event(50, "end"),)
        r = self.run_case((g.Operation("example", "model-a", (events, forbidden)),
                          g.Operation("example-backup", "model-b", (forbidden,))))
        self.assertEqual(r.outcome, "error")
        self.assertEqual(len(r.outgoing_headers), 1)
        self.assertEqual(r.telemetry.points(g.FALLBACKS), [])
        self.assertEqual(r.telemetry.points(g.RETRIES), [])
        self.assertEqual(r.telemetry.points(g.PREFIX + "usage.output_tokens"), [])

    def test_invalid_or_duplicate_usage_is_rejected(self):
        with self.assertRaises(ValueError):
            g.Usage(10, 5, cache_read=11)
        with self.assertRaises(ValueError):
            g.Usage(10, 5, reasoning=6)
        events = (g.Event(10, "usage", g.Usage(10, 5)),
                  g.Event(20, "usage", g.Usage(10, 5)), g.Event(30, "end"))
        with self.assertRaises(ValueError):
            g.run((g.Operation("example", "model-a", (events,)),))

    def test_metric_attributes_exclude_identifiers_and_attempt_numbers(self):
        r = self.run_case()
        for name in r.telemetry.instruments:
            for point in r.telemetry.points(name):
                self.assertFalse({"trace_id", "span_id", "session.id", "request_id",
                                  "llm_gateway.attempt", "http.request.resend_count"} & set(point.attributes))
        self.assertNotIn("gen_ai.server.time_to_first_token", r.telemetry.instruments)
        self.assertNotIn("gen_ai.client.operation.duration", r.telemetry.instruments)


if __name__ == "__main__":
    unittest.main()
