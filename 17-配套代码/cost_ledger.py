"""离线教学计价器：同一文本输入价 / 输出价下的 Token 项目。

不聚合流式事件；final 指用量是否最终完整，cache_writes 按已核实模型能力指定。
不处理多模态、工具次数、价格阶梯、持久账本或真实厂商结算。
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

Source = Literal["provider", "gateway_observed", "gateway_estimated"]


@dataclass(frozen=True)
class Count:
    value: int | None
    source: Source = "provider"
    complete: bool = True

    def __post_init__(self):
        if self.value is not None and (type(self.value) is not int or self.value < 0):
            raise ValueError("Token 数必须是非负整数或 None")
        if self.source not in ("provider", "gateway_observed", "gateway_estimated"):
            raise ValueError("未知的用量来源")
        if type(self.complete) is not bool:
            raise ValueError("complete 必须是布尔值")
        if self.value is None:
            object.__setattr__(self, "complete", False)


@dataclass(frozen=True)
class NormalizedUsage:
    api: str
    items: dict[str, Count]       # 互斥的计价项目；未分类写入不能直接定价
    reasoning: Count             # 输出总量的分析子集，不再加进 items
    raw: dict                   # 深拷贝的原始 usage；不是完整持久账本


def _counter(obj: dict, key: str) -> int | None:
    value = obj.get(key)
    Count(value)                # 拒绝负数、浮点数和布尔值；缺失 / null 保留 None
    return value


def _details(obj: dict, key: str) -> dict:
    value = obj.get(key)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{key} 必须是对象或 null")
    return value


def _writes(total: int | None, details: dict, fields: dict[str, str]) -> dict:
    known = {name: _counter(details, field) for name, field in fields.items()}
    known = {name: value for name, value in known.items() if value is not None}
    subtotal = sum(known.values())
    if total is not None:
        if subtotal > total:
            raise ValueError("TTL 明细超过缓存写入总量")
        if fields and len(known) == len(fields) and subtotal != total:
            raise ValueError("完整 TTL 明细之和与缓存写入总量不一致")
    remainder = None if total is None else total - subtotal
    if remainder != 0:
        # 缺失总量或无法归类的剩余量保留，不猜成短 TTL。
        known["cache_write_unclassified"] = remainder
    return known


def _normalized(api: str, raw: dict, items: dict, reasoning: int | None,
                *, final: bool) -> NormalizedUsage:
    if type(final) is not bool:
        raise ValueError("final 必须是布尔值")
    output = items["output_total"]
    if output is not None and reasoning is not None and reasoning > output:
        raise ValueError("推理 Token 超过输出总量")
    return NormalizedUsage(
        api, {name: Count(value, complete=final) for name, value in items.items()},
        Count(reasoning, complete=final), deepcopy(raw),
    )


def from_openai(usage: dict, *, api: Literal["chat_completions", "responses"],
                cache_writes: bool, final: bool) -> NormalizedUsage:
    if type(cache_writes) is not bool:
        raise ValueError("cache_writes 必须明确为 True 或 False")
    if api == "chat_completions":
        input_key, output_key = "prompt_tokens", "completion_tokens"
    elif api == "responses":
        input_key, output_key = "input_tokens", "output_tokens"
    else:
        raise ValueError("不支持的 OpenAI 接口")
    inp = _counter(usage, input_key)
    out = _counter(usage, output_key)
    detail = _details(usage, input_key + "_details")
    cached = _counter(detail, "cached_tokens")
    written = _counter(detail, "cache_write_tokens")
    ttl = _details(detail, "cache_write_tokens_details")
    if not cache_writes:
        if written not in (None, 0) or any(v not in (None, 0) for v in ttl.values()):
            raise ValueError("返回了缓存写入量，与指定的模型能力不符")
        written = 0            # 明确不支持写入计费的模型配置，不是缺字段推断
    known_input_parts = sum(x for x in (cached, written) if x is not None)
    if inp is not None and known_input_parts > inp:
        raise ValueError("缓存读取 / 写入之和超过输入总量")
    ordinary = inp - cached - written if None not in (inp, cached, written) else None
    fields = ({"cache_write_30m": "ttl_30m_tokens",
               "cache_write_12h": "ttl_12h_tokens"} if api == "responses" else {})
    # 本例只解析已核实的 Responses TTL 字段。Chat 写入无明细时保留未分类。
    items = {"input_uncached": ordinary, "cache_read": cached,
             **_writes(written, ttl, fields), "output_total": out}
    reasoning = _counter(_details(usage, output_key + "_details"), "reasoning_tokens")
    return _normalized("openai/" + api, usage, items, reasoning, final=final)


def from_anthropic(usage: dict, *, final: bool) -> NormalizedUsage:
    items = {
        "input_uncached": _counter(usage, "input_tokens"),
        "cache_read": _counter(usage, "cache_read_input_tokens"),
        **_writes(_counter(usage, "cache_creation_input_tokens"),
                  _details(usage, "cache_creation"),
                  {"cache_write_5m": "ephemeral_5m_input_tokens",
                   "cache_write_1h": "ephemeral_1h_input_tokens"}),
        "output_total": _counter(usage, "output_tokens"),
    }
    reasoning = _counter(_details(usage, "output_tokens_details"), "thinking_tokens")
    return _normalized("anthropic/messages", usage, items, reasoning, final=final)


@dataclass(frozen=True)
class PriceCard:
    version: str
    currency: str
    per_million: dict[str, Decimal]

    def __post_init__(self):
        if not self.version or not self.currency:
            raise ValueError("价格版本与币种不能为空")
        for value in self.per_million.values():
            if not isinstance(value, Decimal) or not value.is_finite() or value < 0:
                raise ValueError("单价必须为有限、非负的 Decimal")


@dataclass(frozen=True)
class PricedCost:
    known_subtotal: Decimal
    total: Decimal | None        # 存在未知用量、未分类项或缺价时为 None
    status: Literal["pending", "estimated", "calculated"]
    price_version: str
    currency: str
    issues: tuple[str, ...]


def price_cost(usage: NormalizedUsage, card: PriceCard) -> PricedCost:
    subtotal = Decimal("0")
    pending, uncertain = [], []
    for name, count in usage.items.items():
        if count.value is None:
            pending.append(f"{name}: 用量未知")
            continue
        if not count.complete or count.source != "provider":
            uncertain.append(f"{name}: 部分用量或网关估算")
        if count.value == 0:
            continue
        if name == "cache_write_unclassified":
            pending.append(f"{name}: 缺少计价类别")
            continue
        rate = card.per_million.get(name)
        if rate is None:
            pending.append(f"{name}: 缺少价格")
            continue
        subtotal += Decimal(count.value) * rate / Decimal("1000000")
    status = "pending" if pending else "estimated" if uncertain else "calculated"
    return PricedCost(subtotal, None if pending else subtotal, status,
                      card.version, card.currency, tuple(pending + uncertain))
