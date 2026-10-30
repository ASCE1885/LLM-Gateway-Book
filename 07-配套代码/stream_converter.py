"""第 07 讲：已解析事件 → Chat Completions 分片的教学适配器。

仅支持文本和客户端 function tools；不负责 HTTP、SSE 分帧、重试或执行工具。
未知语义显式失败；调用方必须捕获异常，并在上游 EOF 时调用 on_eof()。
"""
import json
import time
import uuid


STOP_REASON_MAP = {
    "end_turn": "stop",
    "stop_sequence": "stop",
    "max_tokens": "length",
    "tool_use": "tool_calls",
}


class StreamConversionError(Exception):
    def __init__(self, kind, detail):
        self.kind = kind
        self.detail = detail
        super().__init__(f"{kind}: {detail}")


class AnthropicToOpenAIStream:
    def __init__(self, model, *, include_usage=False, validate_tool=None,
                 max_tool_bytes=65536):
        self.model = model
        self.include_usage = include_usage
        self.validate_tool = validate_tool
        self.max_tool_bytes = max_tool_bytes
        self.id = "chatcmpl-" + uuid.uuid4().hex
        self.created = int(time.time())
        self.state = "new"
        self.blocks = {}
        self.next_tool_index = 0
        self.raw_usage = {}
        self.raw_stop_reason = None
        self.message_delta_seen = False
        self.stop_sequence = None
        self.final_output_seen = False
        self.usage_known = False
        self.normalized_usage = None

    def _fail(self, kind, detail):
        self.state = "failed"
        raise StreamConversionError(kind, detail)

    def chunk(self, delta, finish_reason=None):
        result = {"id": self.id, "object": "chat.completion.chunk",
                  "created": self.created, "model": self.model,
                  "choices": [{"index": 0, "delta": delta,
                               "finish_reason": finish_reason}]}
        if self.include_usage:
            result["usage"] = None
        return result

    def _update_usage(self, usage, *, final=False):
        if usage is None:
            return
        if not isinstance(usage, dict):
            self._fail("invalid_usage", "usage must be an object")
        for key in ("input_tokens", "output_tokens", "cache_creation_input_tokens",
                    "cache_read_input_tokens"):
            if key in usage and (type(usage[key]) is not int or usage[key] < 0):
                self._fail("invalid_usage", key)
        # message_delta 中的计数是累计值：替换已有值，不逐次累加。
        self.raw_usage.update(usage)
        if final and "output_tokens" in usage:
            self.final_output_seen = True

    def _finish(self):
        if self.raw_stop_reason is None:
            self._fail("missing_stop_reason", "message_stop before a stop reason")
        if any(not b["closed"] for b in self.blocks.values()):
            self._fail("incomplete_block", "message_stop with an open block")
        has_tools = self.next_tool_index > 0
        if self.raw_stop_reason == "tool_use" and not has_tools:
            self._fail("inconsistent_tool_stop", self.raw_stop_reason)
        self.state = "ended"
        self.usage_known = "input_tokens" in self.raw_usage and self.final_output_seen
        out = [self.chunk({}, STOP_REASON_MAP[self.raw_stop_reason])]
        if self.usage_known:
            u = self.raw_usage
            prompt = (u["input_tokens"] + u.get("cache_creation_input_tokens", 0)
                      + u.get("cache_read_input_tokens", 0))
            self.normalized_usage = {
                "prompt_tokens": prompt, "completion_tokens": u["output_tokens"],
                "total_tokens": prompt + u["output_tokens"],
                "prompt_tokens_details": {"cached_tokens": u.get("cache_read_input_tokens", 0)},
            }
            # 缓存写入等原始分类保存在 raw_usage，不能用归一总量直接算费用。
            if self.include_usage:
                out.append({**self.chunk({}), "choices": [], "usage": self.normalized_usage})
        out.append("[DONE]")
        return out

    def on_event(self, event):
        if self.state in ("ended", "failed"):
            self._fail("invalid_state", "event after terminal state")
        try:
            return self._on_event(event)
        except StreamConversionError:
            raise
        except (KeyError, TypeError, ValueError) as exc:
            self._fail("malformed_event", str(exc))

    def _message_delta(self, event):
        if any(not b["closed"] for b in self.blocks.values()):
            self._fail("incomplete_block", "message_delta with an open block")
        self.message_delta_seen = True
        self._update_usage(event.get("usage"), final=True)
        reason = event.get("delta", {}).get("stop_reason")
        if reason is not None:
            if reason not in STOP_REASON_MAP:
                self._fail("unsupported_stop_reason", reason)
            if self.raw_stop_reason not in (None, reason):
                self._fail("conflicting_stop_reason", reason)
            self.raw_stop_reason = reason
            self.stop_sequence = event.get("delta", {}).get("stop_sequence")
        return []  # 可以有多个累计更新；确认 message_stop 后只收尾一次。

    def _on_event(self, event):
        t = event["type"]
        if t == "error":
            self._fail("upstream_error", event.get("error", {}))
        if t == "ping":
            return []  # 是否生成下游注释心跳，由 HTTP 层按提交策略决定。
        if t == "message_start":
            if self.state != "new":
                self._fail("invalid_order", "duplicate message_start")
            if event["message"].get("content", []):
                self._fail("unsupported_initial_content", "expected empty content")
            self._update_usage(event["message"].get("usage"))
            self.state = "streaming"
            return [self.chunk({"role": "assistant", "content": ""})]
        if self.state != "streaming":
            self._fail("invalid_order", "message_start is required")

        if t == "message_delta":
            return self._message_delta(event)
        if t == "message_stop":
            return self._finish()
        if self.message_delta_seen:
            self._fail("invalid_order", "content after message_delta")

        if t == "content_block_start":
            idx, content = event["index"], event["content_block"]
            if type(idx) is not int or idx < 0 or idx in self.blocks:
                self._fail("invalid_block_index", idx)
            kind = content["type"]
            if kind not in ("text", "tool_use"):
                self._fail("unsupported_block", kind)
            b = {"type": kind, "closed": False}
            self.blocks[idx] = b
            if kind == "text":
                value = content.get("text", "")
                if not isinstance(value, str):
                    self._fail("invalid_text", idx)
                return [self.chunk({"content": value})] if value else []
            if content.get("input", {}) != {}:
                self._fail("unsupported_initial_tool_input", "this demo expects empty input")
            if not all(isinstance(content.get(k), str) and content[k] for k in ("id", "name")):
                self._fail("invalid_tool", "id and name are required")
            b.update(tool_index=self.next_tool_index, name=content["name"], args="", size=0)
            self.next_tool_index += 1
            return [self.chunk({"tool_calls": [{
                "index": b["tool_index"], "id": content["id"], "type": "function",
                "function": {"name": content["name"], "arguments": ""}}]})]

        if t in ("content_block_delta", "content_block_stop"):
            b = self.blocks.get(event["index"])
            if b is None or b["closed"]:
                self._fail("invalid_block_state", event["index"])
            if t == "content_block_stop":
                if b["type"] == "tool_use":
                    try:
                        def reject_constant(value):
                            raise ValueError(f"invalid JSON constant: {value}")
                        args = json.loads(b["args"] or "{}", parse_constant=reject_constant)
                        if not isinstance(args, dict):
                            raise ValueError("tool input must be an object")
                        if self.validate_tool:
                            self.validate_tool(b["name"], args)
                    except ValueError as exc:
                        self._fail("invalid_tool_input", str(exc))
                b["closed"] = True
                if b["type"] == "tool_use" and not b["args"]:
                    return [self.chunk({"tool_calls": [{"index": b["tool_index"],
                            "function": {"arguments": "{}"}}]})]
                return []  # 必须记录块已闭合；无参数工具补齐 {}，其余无需输出。
            d = event["delta"]
            if b["type"] == "text" and d["type"] == "text_delta":
                if not isinstance(d["text"], str):
                    self._fail("invalid_text", event["index"])
                return [self.chunk({"content": d["text"]})] if d["text"] else []
            if b["type"] == "tool_use" and d["type"] == "input_json_delta":
                part = d["partial_json"]
                if not isinstance(part, str):
                    self._fail("invalid_tool_input", "partial_json must be a string")
                b["size"] += len(part.encode("utf-8"))
                if b["size"] > self.max_tool_bytes:
                    self._fail("tool_input_too_large", event["index"])
                b["args"] += part
                return [self.chunk({"tool_calls": [{"index": b["tool_index"],
                        "function": {"arguments": part}}]})] if part else []
            self._fail("unsupported_delta", d["type"])
        self._fail("unsupported_event", t)

    def on_eof(self):
        """HTTP 层读到 EOF 必须调用；不能自行补一个成功的 [DONE]。"""
        if self.state != "ended":
            self._fail("unexpected_eof", "upstream ended without a valid message_stop")
