import json
import unittest
from stream_converter import AnthropicToOpenAIStream, StreamConversionError
from demo import sample_events, validate_weather


def start(usage=None):
    return {"type": "message_start", "message": {"usage": usage or {
        "input_tokens": 10, "output_tokens": 1}}}


def delta(reason=None, usage=None):
    e = {"type": "message_delta", "delta": {"stop_reason": reason}}
    if usage is not None:
        e["usage"] = usage
    return e


def tool(idx=3, name="get_weather", call_id="toolu_a"):
    return {"type": "content_block_start", "index": idx,
            "content_block": {"type": "tool_use", "id": call_id,
                              "name": name, "input": {}}}


def arg(part, idx=3):
    return {"type": "content_block_delta", "index": idx,
            "delta": {"type": "input_json_delta", "partial_json": part}}


def close(idx=3):
    return {"type": "content_block_stop", "index": idx}


def run_events(converter, events):
    out = []
    for event in events:
        out.extend(converter.on_event(event))
    converter.on_eof()
    return out


class ConverterTests(unittest.TestCase):
    def expect_error(self, converter, events, kind):
        out = []
        with self.assertRaises(StreamConversionError) as ctx:
            for e in events:
                out.extend(converter.on_event(e))
        self.assertEqual(ctx.exception.kind, kind)
        self.assertEqual(converter.state, "failed")
        self.assertNotIn("[DONE]", out)
        return out

    def test_demo_roundtrip_and_usage(self):
        c = AnthropicToOpenAIStream("demo", include_usage=True, validate_tool=validate_weather)
        out = run_events(c, sample_events())
        chunks = [x for x in out if isinstance(x, dict)]
        self.assertEqual(out[-1], "[DONE]")
        self.assertEqual(sum(x == "[DONE]" for x in out), 1)
        self.assertEqual(len({x["id"] for x in chunks}), 1)
        self.assertEqual(len({x["created"] for x in chunks}), 1)
        calls = [call for x in chunks for choice in x["choices"]
                 for call in choice["delta"].get("tool_calls", [])]
        self.assertEqual(json.loads(''.join(t['function']['arguments'] for t in calls)),
                         {"city": "北京"})
        self.assertEqual([x['choices'][0]['finish_reason'] for x in chunks
                          if x['choices'] and x['choices'][0]['finish_reason']], ['tool_calls'])
        u = chunks[-1]['usage']
        self.assertEqual((u['prompt_tokens'], u['completion_tokens'], u['total_tokens']),
                         (125, 40, 165))
        self.assertEqual(u['prompt_tokens_details']['cached_tokens'], 80)
        self.assertEqual(c.raw_usage['cache_creation_input_tokens'], 20)

    def test_usage_is_collected_even_when_not_exposed(self):
        c = AnthropicToOpenAIStream("demo")
        out = run_events(c, sample_events())
        self.assertTrue(c.usage_known)
        self.assertTrue(all('usage' not in x for x in out if isinstance(x, dict)))

    def test_missing_final_usage_does_not_invent_zero_or_fail_content(self):
        c = AnthropicToOpenAIStream("demo", include_usage=True)
        out = run_events(c, [start(), delta('end_turn'), {"type": "message_stop"}])
        self.assertEqual(out[-1], '[DONE]')
        self.assertFalse(c.usage_known)
        self.assertIsNone(c.normalized_usage)
        self.assertEqual(c.raw_usage['output_tokens'], 1)
        self.assertFalse(any(isinstance(x, dict) and x.get('usage') is not None for x in out))

    def test_cumulative_usage_and_late_input_update(self):
        c = AnthropicToOpenAIStream("demo", include_usage=True)
        out = run_events(c, [start(), delta(None, {'output_tokens': 30}),
            delta('end_turn', {'input_tokens': 100, 'cache_read_input_tokens': 900,
                              'cache_creation_input_tokens': 200, 'output_tokens': 40}),
            {"type": "message_stop"}])
        self.assertEqual(c.normalized_usage['prompt_tokens'], 1200)
        self.assertEqual(c.normalized_usage['completion_tokens'], 40)
        self.assertEqual(len([x for x in out if isinstance(x, dict) and x.get('usage')]), 1)

    def test_null_stop_reason_does_not_end_response(self):
        c = AnthropicToOpenAIStream("demo")
        c.on_event(start())
        self.assertEqual(c.on_event(delta(None, {'output_tokens': 20})), [])
        self.assertEqual(c.state, 'streaming')
        self.expect_error(c, [{"type": "message_stop"}], 'missing_stop_reason')

    def test_unsupported_stop_reasons_never_become_stop(self):
        for reason in ('pause_turn', 'model_context_window_exceeded', 'refusal', 'future_reason'):
            with self.subTest(reason=reason):
                self.expect_error(AnthropicToOpenAIStream('demo'),
                                  [start(), delta(reason)], 'unsupported_stop_reason')

    def test_upstream_error_is_reported(self):
        c = AnthropicToOpenAIStream('demo')
        self.expect_error(c, [start(), {'type': 'error', 'error': {'type': 'overloaded_error'}}],
                          'upstream_error')
        self.assertFalse(c.usage_known)

    def test_eof_before_message_stop_never_synthesizes_done(self):
        for events in ([], [start()], [start(), delta('end_turn', {'output_tokens': 4})],
                       [start(), tool(), arg('{"city":')]):
            with self.subTest(events=events):
                c = AnthropicToOpenAIStream('demo')
                out = [x for e in events for x in c.on_event(e)]
                with self.assertRaises(StreamConversionError) as ctx:
                    c.on_eof()
                self.assertEqual(ctx.exception.kind, 'unexpected_eof')
                self.assertNotIn('[DONE]', out)
                self.assertFalse(any(isinstance(x, dict) and x['choices'] and
                                     x['choices'][0]['finish_reason'] for x in out))

    def test_tool_validation_occurs_at_block_end(self):
        checked = []
        c = AnthropicToOpenAIStream('demo', validate_tool=lambda n, a: checked.append((n, a)))
        c.on_event(start()); c.on_event(tool()); c.on_event(arg('{"city":"北京"}'))
        self.assertEqual(checked, [])
        c.on_event(close())
        self.assertEqual(checked, [('get_weather', {'city': '北京'})])
        self.assertEqual(c.state, 'streaming')

    def test_malformed_and_schema_invalid_tools(self):
        for value in ('{"city":', '[]', '{"city":null}', '{"city":NaN}'):
            with self.subTest(value=value):
                self.expect_error(AnthropicToOpenAIStream('demo', validate_tool=validate_weather),
                                  [start(), tool(), arg(value), close()], 'invalid_tool_input')

    def test_parameter_limit_counts_utf8_bytes(self):
        self.expect_error(AnthropicToOpenAIStream('demo', max_tool_bytes=5),
                          [start(), tool(), arg('北京')], 'tool_input_too_large')

    def test_empty_argument_object_is_emitted(self):
        c = AnthropicToOpenAIStream('demo')
        out = run_events(c, [start(), tool(name='ping'), close(), delta('tool_use'),
                            {'type': 'message_stop'}])
        args = ''.join(call['function']['arguments'] for x in out if isinstance(x, dict)
                       for choice in x['choices'] for call in choice['delta'].get('tool_calls', []))
        self.assertEqual(json.loads(args), {})

    def test_multiple_tool_indices_are_stable_and_dense(self):
        c = AnthropicToOpenAIStream('demo')
        events = [start(), tool(2, call_id='a'), arg('{"x":1}', 2), close(2),
                  tool(5, call_id='b'), arg('{"x":2}', 5), close(5),
                  delta('tool_use'), {'type': 'message_stop'}]
        out = run_events(c, events)
        calls = [call for x in out if isinstance(x, dict) for choice in x['choices']
                 for call in choice['delta'].get('tool_calls', [])]
        self.assertEqual([t['index'] for t in calls], [0, 0, 1, 1])
        self.assertEqual([t['id'] for t in calls if 'id' in t], ['a', 'b'])

    def test_open_blocks_and_invalid_order_fail(self):
        cases = [([start(), tool(), {'type': 'message_stop'}], 'missing_stop_reason'),
                 ([start(), tool(), delta('tool_use')], 'incomplete_block'),
                 ([start(), close()], 'invalid_block_state'),
                 ([delta('end_turn')], 'invalid_order'),
                 ([start(), start()], 'invalid_order'),
                 ([start(), delta(None, {'output_tokens': 4}), tool()], 'invalid_order'),
                 ([start(), delta('end_turn'), delta('max_tokens')], 'conflicting_stop_reason')]
        for events, kind in cases:
            with self.subTest(kind=kind):
                self.expect_error(AnthropicToOpenAIStream('demo'), events, kind)

    def test_unsupported_content_is_not_silently_dropped(self):
        self.expect_error(AnthropicToOpenAIStream('demo'), [start(), {
            'type': 'content_block_start', 'index': 0,
            'content_block': {'type': 'thinking', 'thinking': ''}}], 'unsupported_block')
        self.expect_error(AnthropicToOpenAIStream('demo'), [start(), {'type': 'future_event'}],
                          'unsupported_event')

    def test_finish_is_emitted_once_and_truncation_is_preserved(self):
        c = AnthropicToOpenAIStream('demo')
        out = run_events(c, [start(), delta('max_tokens', {'output_tokens': 4}),
                            {'type': 'message_stop'}])
        self.assertEqual(out[-2]['choices'][0]['finish_reason'], 'length')
        self.expect_error(c, [{'type': 'message_stop'}], 'invalid_state')

    def test_usage_cannot_be_negative_or_boolean(self):
        for value in (-1, True):
            with self.subTest(value=value):
                self.expect_error(AnthropicToOpenAIStream('demo'),
                                  [start(), delta('end_turn', {'output_tokens': value})],
                                  'invalid_usage')


if __name__ == '__main__':
    unittest.main()
