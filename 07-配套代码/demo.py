"""离线演示：运行 python3 demo.py，标准输出为 SSE，标准错误为验证结果。"""
import json
import sys
from stream_converter import AnthropicToOpenAIStream, StreamConversionError


def validate_weather(name, args):
    # 本例工具的输入约束；通用网关应使用相应 JSON Schema 校验器。
    if name != "get_weather" or not isinstance(args.get("city"), str) or not args["city"]:
        raise ValueError("get_weather requires a non-empty city string")


def sample_events():
    return [
        {"type": "message_start", "message": {"usage": {
            "input_tokens": 25, "cache_read_input_tokens": 80,
            "cache_creation_input_tokens": 20, "output_tokens": 1}}},
        {"type": "content_block_start", "index": 0,
         "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0,
         "delta": {"type": "text_delta", "text": "我来查一下"}},
        {"type": "content_block_stop", "index": 0},
        {"type": "content_block_start", "index": 1,
         "content_block": {"type": "tool_use", "id": "toolu_1",
                           "name": "get_weather", "input": {}}},
        {"type": "content_block_delta", "index": 1,
         "delta": {"type": "input_json_delta", "partial_json": '{"city": "北'}},
        {"type": "content_block_delta", "index": 1,
         "delta": {"type": "input_json_delta", "partial_json": '京"}'}},
        {"type": "content_block_stop", "index": 1},
        {"type": "message_delta", "delta": {"stop_reason": None},
         "usage": {"output_tokens": 30}},
        {"type": "message_delta", "delta": {"stop_reason": "tool_use"},
         "usage": {"output_tokens": 40}},
        {"type": "ping"},
        {"type": "message_stop"},
    ]


def main():
    c = AnthropicToOpenAIStream("chat-default", include_usage=True,
                                validate_tool=validate_weather)
    try:
        for event in sample_events():
            for chunk in c.on_event(event):
                data = chunk if isinstance(chunk, str) else json.dumps(chunk, ensure_ascii=False)
                print(f"data: {data}\n", flush=True)
        c.on_eof()
    except StreamConversionError as exc:
        # 真实 HTTP 层按响应头是否提交决定 HTTP 错误或约定的流内错误；不补 [DONE]。
        print(str(exc), file=sys.stderr)
        return 1
    print(f"state={c.state}, usage_known={c.usage_known}, usage={c.normalized_usage}",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
