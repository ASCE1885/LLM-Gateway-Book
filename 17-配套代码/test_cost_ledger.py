"""有界、离线的计量与计价回归用例。"""
import unittest
from dataclasses import replace
from decimal import Decimal as D
from cost_ledger import Count, PriceCard, from_openai, from_anthropic, price_cost
from demo import PRICE


class BillingTests(unittest.TestCase):
    def setUp(self):
        self.chat = {"prompt_tokens": 12000, "completion_tokens": 900,
                     "prompt_tokens_details": {"cached_tokens": 10000},
                     "completion_tokens_details": {"reasoning_tokens": 600}}
        self.messages = {"input_tokens": 500, "cache_read_input_tokens": 0,
                         "cache_creation_input_tokens": 4000,
                         "cache_creation": {"ephemeral_5m_input_tokens": 2000,
                                            "ephemeral_1h_input_tokens": 2000},
                         "output_tokens": 300}
        self.responses = {"input_tokens": 12000, "output_tokens": 900,
                          "input_tokens_details": {"cached_tokens": 4000, "cache_write_tokens": 7000,
                              "cache_write_tokens_details": {"ttl_30m_tokens": 3000,
                                                             "ttl_12h_tokens": 4000}},
                          "output_tokens_details": {"reasoning_tokens": 600}}

    def normalize_chat(self, data=None, final=True):
        return from_openai(self.chat if data is None else data, api="chat_completions",
                           cache_writes=False, final=final)

    def test_equivalent_provider_usage(self):
        a = self.normalize_chat()
        b = from_anthropic({"input_tokens": 2000, "cache_read_input_tokens": 10000,
                            "cache_creation_input_tokens": 0, "output_tokens": 900}, final=True)
        self.assertEqual(price_cost(a, PRICE).total, D("0.066"))
        self.assertEqual(price_cost(b, PRICE).total, D("0.066"))
        self.assertEqual(a.reasoning.value, 600)
        self.assertEqual(a.items["output_total"].value, 900)
        self.assertIsNone(b.reasoning.value)  # 分析明细未知，不阻止总输出计价

    def test_responses_write_partition(self):
        u = from_openai(self.responses, api="responses", cache_writes=True, final=True)
        self.assertEqual(u.items["input_uncached"].value, 1000)
        self.assertEqual(price_cost(u, PRICE).total, D("0.1875"))
        self.assertEqual(sum(c.value for k, c in u.items.items() if k != "output_total"), 12000)

    def test_anthropic_thinking_is_subset(self):
        self.messages["output_tokens_details"] = {"thinking_tokens": 200}
        u = from_anthropic(self.messages, final=True)
        self.assertEqual(u.reasoning.value, 200)
        self.assertEqual(price_cost(u, PRICE).total, D("0.082"))

    def test_article_mixed_ttl_denominators(self):
        right = price_cost(from_anthropic(self.messages, final=True), PRICE).total
        wrong = D("0.067")
        self.assertEqual(right, D("0.082"))
        self.assertEqual(((right-wrong)/right*100).quantize(D("0.1")), D("18.3"))
        self.assertEqual(((D("0.065")-D("0.050"))/D("0.065")*100).quantize(D("0.1")), D("23.1"))

    def test_missing_ttl_remains_unclassified(self):
        del self.messages["cache_creation"]
        u = from_anthropic(self.messages, final=True)
        self.assertEqual(u.items["cache_write_unclassified"].value, 4000)
        self.assertNotIn("cache_write_5m", u.items)
        result = price_cost(u, PRICE)
        self.assertEqual(result.status, "pending")
        self.assertIsNone(result.total)
        self.assertEqual(result.known_subtotal, D("0.017"))

    def test_partial_ttl_preserves_remaining_quantity(self):
        del self.messages["cache_creation"]["ephemeral_1h_input_tokens"]
        u = from_anthropic(self.messages, final=True)
        self.assertEqual(u.items["cache_write_unclassified"].value, 2000)
        self.assertIsNone(price_cost(u, PRICE).total)

    def test_missing_price_does_not_fall_back(self):
        p = PriceCard("missing-v1", "CNY", {"input_uncached": D(10), "output_total": D(40)})
        r = price_cost(from_anthropic(self.messages, final=True), p)
        self.assertEqual(r.status, "pending")
        self.assertEqual(r.known_subtotal, D("0.017"))
        self.assertTrue(any("缺少价格" in s for s in r.issues))

    def test_null_and_absent_counters_not_zero(self):
        for value in ({}, {"input_tokens": None, "output_tokens": None}):
            with self.subTest(value=value):
                u = from_anthropic(value, final=True)
                self.assertIsNone(u.items["input_uncached"].value)
                self.assertIsNone(price_cost(u, PRICE).total)
        self.chat["prompt_tokens_details"]["cached_tokens"] = None
        self.assertIsNone(price_cost(self.normalize_chat(), PRICE).total)

    def test_invalid_numbers_and_inconsistent_totals(self):
        for value in (-1, 1.5, True, "100"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                from_anthropic({**self.messages, "output_tokens": value}, final=True)
        self.chat["prompt_tokens"] = 100
        with self.assertRaises(ValueError):
            self.normalize_chat()
        for value in (3000, 5000):
            with self.subTest(write_total=value), self.assertRaises(ValueError):
                from_anthropic({**self.messages, "cache_creation_input_tokens": value}, final=True)
        self.messages["output_tokens_details"] = {"thinking_tokens": 301}
        with self.assertRaises(ValueError):
            from_anthropic(self.messages, final=True)

    def test_partial_and_estimated_not_final_cost(self):
        u = self.normalize_chat(final=False)
        self.assertEqual(price_cost(u, PRICE).status, "estimated")
        u = self.normalize_chat()
        items = dict(u.items)
        items["output_total"] = Count(700, "gateway_estimated", complete=False)
        result = price_cost(replace(u, items=items), PRICE)
        self.assertEqual(result.status, "estimated")
        self.assertEqual(result.total, D("0.058"))
        items["output_total"] = Count(None)
        self.assertEqual(price_cost(replace(u, items=items), PRICE).status, "pending")
        self.assertTrue(items["input_uncached"].complete)

    def test_capability_mismatch_rejected(self):
        self.chat["prompt_tokens_details"]["cache_write_tokens"] = 100
        with self.assertRaises(ValueError):
            self.normalize_chat()
        with self.assertRaises(ValueError):
            from_openai({}, api="unknown", cache_writes=False, final=True)

    def test_chat_write_without_ttl_is_pending(self):
        self.chat["prompt_tokens_details"]["cache_write_tokens"] = 100
        u = from_openai(self.chat, api="chat_completions", cache_writes=True, final=True)
        self.assertEqual(u.items["input_uncached"].value, 1900)
        self.assertIsNone(price_cost(u, PRICE).total)

    def test_raw_snapshot_is_copied(self):
        u = self.normalize_chat()
        self.chat["prompt_tokens_details"]["cached_tokens"] = 0
        self.assertEqual(u.raw["prompt_tokens_details"]["cached_tokens"], 10000)

    def test_zero_usage_needs_no_positive_charge(self):
        u = from_anthropic({"input_tokens": 0, "cache_read_input_tokens": 0,
                            "cache_creation_input_tokens": 0, "output_tokens": 0}, final=True)
        self.assertEqual(price_cost(u, PriceCard("zero", "CNY", {})).total, D(0))

    def test_decimal_prices_and_no_per_request_cent_rounding(self):
        for value in (10.0, D("NaN"), D("Infinity"), D("-1")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                PriceCard("bad", "CNY", {"output_total": value})
        u = from_anthropic({"input_tokens": 0, "cache_read_input_tokens": 0,
                            "cache_creation_input_tokens": 0, "output_tokens": 1}, final=True)
        r = price_cost(u, PRICE)
        self.assertEqual(r.total, D("0.00004"))
        self.assertEqual(sum([r.total] * 1000), D("0.04"))
        self.assertEqual((r.currency, r.price_version), ("CNY", "fictional-v1"))


if __name__ == "__main__":
    unittest.main()
