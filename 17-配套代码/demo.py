"""离线复算正文示例，不调用模型或读取凭证。"""
from decimal import Decimal as D
from cost_ledger import PriceCard, from_openai, from_anthropic, price_cost

PRICE = PriceCard("fictional-v1", "CNY", {name: D(value) for name, value in {
    "input_uncached": "10", "cache_read": "1", "cache_write_5m": "12.5",
    "cache_write_1h": "20", "cache_write_30m": "12.5", "cache_write_12h": "25",
    "output_total": "40",
}.items()})


def show(label, usage, card=PRICE):
    result = price_cost(usage, card)
    amount = "待确认" if result.total is None else str(result.total.quantize(D("0.000001")))
    print(f"{label}: {amount} {result.currency}; {result.status}; "
          f"已计价部分={result.known_subtotal}; {', '.join(result.issues)}")
    return result


if __name__ == "__main__":
    chat = {"prompt_tokens": 12000, "completion_tokens": 900,
            "prompt_tokens_details": {"cached_tokens": 10000},
            "completion_tokens_details": {"reasoning_tokens": 600}}
    messages = {"input_tokens": 2000, "cache_read_input_tokens": 10000,
                "cache_creation_input_tokens": 0, "output_tokens": 900}
    show("旧模型 Chat 示例", from_openai(chat, api="chat_completions",
                                           cache_writes=False, final=True))
    show("Messages 示例", from_anthropic(messages, final=True))
    print("漏计缓存读取: 0.056 元；忽略缓存折扣: 0.156 元")

    mixed = {"input_tokens": 500, "cache_read_input_tokens": 0,
             "cache_creation_input_tokens": 4000,
             "cache_creation": {"ephemeral_5m_input_tokens": 2000,
                                "ephemeral_1h_input_tokens": 2000},
             "output_tokens": 300}
    result = show("混合 TTL", from_anthropic(mixed, final=True))
    wrong = (D(500)*10 + D(4000)*D("12.5") + D(300)*40) / D(1000000)
    print(f"统一按 5m: {wrong} 元；整次请求少算 {(1-wrong/result.total):.1%}")

    responses = {"input_tokens": 12000, "output_tokens": 900,
                 "input_tokens_details": {"cached_tokens": 4000, "cache_write_tokens": 7000,
                     "cache_write_tokens_details": {"ttl_30m_tokens": 3000, "ttl_12h_tokens": 4000}},
                 "output_tokens_details": {"reasoning_tokens": 600}}
    show("Responses 读写拆分", from_openai(responses, api="responses",
                                              cache_writes=True, final=True))

    missing_ttl = {k: v for k, v in mixed.items() if k != "cache_creation"}
    show("TTL 缺失", from_anthropic(missing_ttl, final=True))
    no_write_price = PriceCard("incomplete-v1", "CNY", {
        "input_uncached": D("10"), "cache_read": D("1"), "output_total": D("40")})
    show("写入单价缺失", from_anthropic(mixed, final=True), no_write_price)
    show("部分用量", from_anthropic(messages, final=False))
