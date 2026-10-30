# 第 07 讲：流式协议转换的离线示例

在本目录运行（Python 3.9+，仅使用标准库）：

```sh
python3 demo.py
python3 -m unittest -v
```

`demo.py` 使用合成的 Anthropic 事件，向标准输出写出 Chat Completions 形式的 SSE；标准错误输出结束状态和用量。它没有发起网络请求，也不会执行 `get_weather`。

转换器接收的是已经分帧、解析的事件字典，不是原始网络字节。输入限于文本、以空对象开始的客户端 `tool_use`、对应增量与闭合事件，以及 `message_start`、`message_delta`、`message_stop`、`ping` 和 `error`。仅支持正文列明的四种停止原因；其他内容和语义显式失败。

集成时必须遵守以下约定：

1. 将请求中调用方的用量偏好传给 `include_usage`。即使不向客户端输出用量，转换器仍保存 `raw_usage` 和可用的 `normalized_usage`。
2. 在上游 EOF 时调用 `on_eof()`。异常、超时与取消由 HTTP 层处理，不能额外补上 `[DONE]`。
3. 捕获 `StreamConversionError`，根据响应头是否已提交，返回普通 HTTP 错误，或使用客户端支持的流内错误机制／中断流。本例不定义新的 Chat Completions 错误协议。
4. 参数片段可能已向下游转发，后续校验失败不能将它们撤回。应用必须检查调用完成状态与约束后才执行工具。`validate_tool` 回调用 `ValueError` 报告失败；生产使用相应的 JSON Schema 和权限校验。
5. `usage_known` 仅在有效终止且取得输入和最终输出计数时为真。缺失最终用量不阻止完整内容结束，但不能把初始用量当作最终计费值。缓存写入、TTL 等细分信息留在原始记录中；本例不做计费。

测试覆盖正常转换、工具参数拼接与校验、多个工具的索引、累计用量更新、用量可见性、缺失用量、流内错误、未知停止原因、提前 EOF 和非法事件顺序。未验证真实厂商流、SDK 兼容性、SSE 分帧、网络超时、取消传播、背压和重试策略；这些属于完整 HTTP 网关的集成范围。
