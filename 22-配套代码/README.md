# 第 22 讲配套示例与配图

本目录验证一次流式调用的 Span 层级、计时边界和用量归属。所有事件、时间和 usage 都是合成数据，不请求外部模型，不读取业务数据。

## 版本与复现

- GenAI 语义约定快照：`e6658f14c9d9ea0760825f029cb82e7673f48fab`（2026-11-06）。
- Python SDK：`opentelemetry-sdk==1.38.0`。SDK 版本不代表实现了该 GenAI 快照；本例手工创建指标与 Span，不启用自动插桩。
- Python 3.10 或更高版本；使用虚拟环境隔离依赖。

```bash
python3 -m venv /tmp/llmgw22-env
/tmp/llmgw22-env/bin/python -m pip install -r 22-配套代码/requirements.txt
/tmp/llmgw22-env/bin/python 22-配套代码/gateway_telemetry.py
/tmp/llmgw22-env/bin/python -m unittest discover -s 22-配套代码 -p 'test_*.py' -v
```

可选 `--scenario retry`（默认）、`error`、`cancel`、`fallback`。默认场景的实际运行输出保存于 `example-output.txt`。

## 测量与统计口径

示例使用显式纳秒时间戳模拟经过的时间，没有 `sleep` 或真实网络；Metric 的时间单位仍为秒。记录中的 Trace ID 随机生成，不出现在演示输出中。`Event.ms` 是相对当前 HTTP 尝试开始的时间，事件已由假想协议适配器分类，不是原始 SSE 字节。

| 测量 | 起点与终点 | 默认场景 |
| --- | --- | --- |
| `gen_ai.client.inference.duration` | 逻辑操作发起至响应接收完成 / 终止，包含自动重试 | 30–600 ms，570 ms |
| `gen_ai.client.inference.time_to_first_chunk` | 逻辑操作发起至首个有效内容接收 | 30–460 ms，430 ms |
| `gen_ai.client.inference.time_per_output_chunk` | 相邻有效内容分片的接收间隔 | 两个 40 ms 样本 |
| `llm_gateway.upstream.attempt.duration` | 单次 HTTP 尝试开始至结束 | 80 ms、440 ms |
| `llm_gateway.upstream.attempt.time_to_first_chunk` | 单次尝试开始至首次有效内容接收 | 成功尝试 300 ms；失败尝试不记录 |
| `llm_gateway.response.time_to_first_content_write` | 网关入站至首次下游内容写出完成 | 480 ms，不代表客户端收到或渲染 |
| `llm_gateway.request.duration` | 网关入站至交付完成 / 失败 / 取消 | 620 ms |
| `llm_gateway.upstream.usage_unknown` | 未返回最终 usage 的尝试次数 | 1 次；不表示未知 Token 的数量 |
| `llm_gateway.upstream.retries` | 同一逻辑操作内，实际追加的尝试次数 | 1 次 |
| `llm_gateway.upstream.fallbacks` | 模拟器切到下一个提供方 / 模型的次数 | 默认 0 次；fallback 场景 1 次 |

为了观察短请求，示例为时延、分片间隔和 Token 分布分别配置了教学桶。这不是规范建议桶的逐项复制，也不是生产调优结论。

HTTP SERVER、GenAI CLIENT、HTTP CLIENT 是不同层次。第一次 HTTP 429 为 Error，重试后成功的 GenAI 逻辑 Span 保留 Unset。取消场景模拟调用方主动取消，记录自有终止原因，不发明 `Cancelled` 状态。

## 用量、缺失值与采样

默认场景有三个有效内容分片，但成功尝试报告 24 个输出 Token；示例只使用显式 usage，绝不按分片数估算。输入 1200 包含缓存读取 800；输出 24 包含推理 6，不能将这些数全部相加。

计数器记录已知的正值；本例未提供模态分解，因此输入、输出、缓存读取贡献标为 `gen_ai.token.modality=unknown`，推理子类不附加模态。示例没有实现缓存写入或真实的多模态适配。`Usage` 的零值代表此合成报告明确为零，不是对缺失字段的生产填充策略。生产适配还需在提供方同时给出使用量和计费用量时按所选规范取值，保持子类关系一致。

第一次 429 没有 usage，仍可能需要其他来源对账。已报告的贡献正常累计，未知尝试单独计数；逻辑操作用量标为 `reported_partial`，不导出伪装完整的 Span Token 总量或单次用量分布。所有尝试的 usage 都已知时，才导出本例的逻辑操作用量分布。分布只反映有完整报告的样本，不能据此推断缺失样本的分布。

响应模型只来自模拟响应字段，不用请求模型代填。未返回响应模型时省略该属性。内容到达后不再重试或 Fallback；这里只是限定的模拟行为，不是完整重放、取消或费用结算实现。

每次实验创建独立的 OTel provider，不修改全局 provider。Metrics 的记录独立于 Trace 采样，测试验证 `ALWAYS_OFF` 时仍有指标。演示只使用内存导出器，不演示 exemplar 的实际后端关联，不记录 Prompt、回答或凭证。

## 验证覆盖与边界

12 项离线回归测试覆盖：

1. 重试计时、层级、状态与不重复计数。
2. 提供方 usage 与分片数独立，子类与总量保持包含关系。
3. 所有尝试失败时不记录不存在的首内容，也不补出 usage。
4. 主动取消保留终止原因，缺失 usage 不填零。
5. Fallback 的不同提供方 / 模型分别统计。
6. Trace 未采样时仍记录指标。
7. 提取可信入站上下文，再注入当前 HTTP 子 Span。
8. 角色、空事件、心跳不计为内容，单分片没有相邻间隔。
9. 中途断流后不自动重放，不发明用量。
10. 重复 usage 和超出总量的子类输入被拒绝。
11. 指标标签不带请求 ID、Trace ID 或尝试序号。
12. 只记录正贡献，未知模态和推理子类属性分别处理。

这些不是生产网关测试。没有运行真实 HTTP / SSE、模型 SDK、Collector、后端、持久队列或账本；没有验证真实取消传播、远端计费、导出丢失、内容上传授权或吞吐。`incoming` 仅供可信测试上下文，不是来自公网请求头的安全过滤器。SDK、HTTP 插桩和网关同时部署时需要另行检查重复记录；本例没有安装它们来验证生产组合。

## 配图与编辑

- 图 22-1：`配图/22-信号关联与内容边界.png`，新增。
- 图 22-2：`配图/22-观测信号.png`，保留原章节位置与文件名，重绘时间线。
- 图 22-3：`配图/22-采集链路与版本治理.png`，新增。

可编辑 SVG 位于 `配图/源文件`，生成脚本为 `render_figures.mjs`。参考宽度 150 mm；PNG 为 300 dpi，宽 1772 像素；最小文字约 9.1 pt。颜色只作辅助，文字与层级在灰度下仍可区分。图内无公众号标识。

需要 Node.js、`sharp`、`@napi-rs/canvas` 和 `Hiragino Sans GB` 中文字体。字体可通过 `DIAGRAM_FONT` 指定；更换字体后需重新目视和检查文字宽度。若模块不在默认搜索路径，可设置 `DIAGRAM_NODE_MODULES` 指向模块目录。

```bash
node 22-配套代码/render_figures.mjs /tmp/llmgw22-preview
```

脚本生成彩色 / 灰度预览和文字、节点、连线的几何记录，供检查排版。时间线数据与默认模拟场景一致。

## 核实来源

核对日期：2026-11-11。正文不在段后堆放外部链接，详细依据同步写入根目录资料核实记录第 48 节。

- [GenAI 推理约定（固定快照）](https://github.com/open-telemetry/semantic-conventions-genai/blob/e6658f14c9d9ea0760825f029cb82e7673f48fab/docs/gen-ai/client-inference.md)
- [GenAI 通用 Span 与内容配置（固定快照）](https://github.com/open-telemetry/semantic-conventions-genai/blob/e6658f14c9d9ea0760825f029cb82e7673f48fab/docs/gen-ai/gen-ai-spans.md)
- [Token 指标（固定快照）](https://github.com/open-telemetry/semantic-conventions-genai/blob/e6658f14c9d9ea0760825f029cb82e7673f48fab/docs/gen-ai/gen-ai-token-metrics.md)
- [模型服务端指标（固定快照）](https://github.com/open-telemetry/semantic-conventions-genai/blob/e6658f14c9d9ea0760825f029cb82e7673f48fab/docs/gen-ai/gen-ai-metrics.md)
- [OTel HTTP Span 约定](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
- [OTel Span 状态](https://opentelemetry.io/docs/specs/otel/trace/api/#set-status)
- [Exemplar](https://opentelemetry.io/docs/specs/otel/metrics/data-model/#exemplars)
- [Baggage 的安全考虑](https://opentelemetry.io/docs/concepts/signals/baggage/)
- [Collector 可靠性](https://opentelemetry.io/docs/collector/resiliency/)
- [Prometheus 标签基数](https://prometheus.io/docs/practices/naming/)
- [Agent Router 1.2 追踪说明](https://theagentrouter.ai/docs/capabilities/observability/tracing/)
- [Agent Router 1.2 指标说明](https://theagentrouter.ai/docs/capabilities/observability/metrics/)
