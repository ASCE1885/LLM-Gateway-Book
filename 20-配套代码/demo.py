"""Offline synthetic example; its output must be rendered as literal plain text."""
from pseudonymizer import Pseudonymizer, RestoreGrant, Scope


def main():
    # Fixed teaching scope. In a service, derive it from authenticated context.
    scope = Scope("tenant-demo", "request-demo", "user-demo")
    prompt = "客户手机号 13812345678，邮箱 zhang@example.com，请起草回访短信，再确认手机号 13812345678。"
    with Pseudonymizer(scope) as p:
        masked = p.mask(prompt)
        phone, email = p.tokens
        # The teaching scenario authorizes this recipient to view both values.
        # This constructor is NOT an authentication or authorization service.
        grant = RestoreGrant(scope, "trusted_plain_text", frozenset(p.tokens))
        stream = p.restorer(grant)
        response = f"您好！我们将通过 {phone} 与您联系，回访结果发送到 {email}。"
        chunks = [response[i:i+5] for i in range(0, len(response), 5)]
        restored = "".join(stream.feed(chunk) for chunk in chunks) + stream.finish()
        # Only synthetic values are printed; never log real mappings or PII here.
        print("发给模型（随机占位符每次运行不同）：", masked)
        print("获准的纯文本展示：", restored)
    print("结束：请求映射和流式暂存引用已释放。")


if __name__ == "__main__":
    main()
