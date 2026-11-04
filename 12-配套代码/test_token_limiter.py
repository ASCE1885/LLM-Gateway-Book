import unittest
from concurrent.futures import ThreadPoolExecutor
from token_limiter import TokenBucket


class TokenBucketTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        self.bucket = TokenBucket(60000, burst_seconds=10, clock=lambda: self.now)

    def test_full_estimate_required(self):
        self.bucket.reserve('a', 9000)
        decision = self.bucket.reserve('b', 2000)
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.wait_seconds, 1)
        self.assertEqual(self.bucket.available_tokens, 1000)
        self.now = 1
        self.assertTrue(self.bucket.reserve('b', 2000).allowed)
        self.assertEqual(self.bucket.available_tokens, 0)

    def test_oversized_request_is_not_retryable_by_waiting(self):
        decision = self.bucket.reserve('a', 1000000)
        self.assertEqual(decision.status, 'oversized')
        self.assertIsNone(decision.retry_after)
        self.assertEqual(self.bucket.available_tokens, 10000)

    def test_exact_capacity_is_allowed(self):
        self.assertTrue(self.bucket.reserve('a', 10000).allowed)
        self.assertEqual(self.bucket.available_tokens, 0)

    def test_refund_and_duplicate_settlement(self):
        self.bucket.reserve('a', 3000)
        result = self.bucket.settle('a', 1200)
        self.assertEqual(result.credited_tokens, 1800)
        self.assertEqual(self.bucket.available_tokens, 8800)
        self.assertTrue(self.bucket.settle('a', 1200).replayed)
        self.assertEqual(self.bucket.available_tokens, 8800)
        with self.assertRaises(ValueError):
            self.bucket.settle('a', 1201)

    def test_reservation_id_cannot_dispatch_twice(self):
        self.bucket.reserve('a', 3000)
        duplicate = self.bucket.reserve('a', 3000)
        self.assertEqual(duplicate.status, 'replayed')
        self.assertFalse(duplicate.allowed)
        with self.assertRaises(ValueError):
            self.bucket.reserve('a', 4000)
        self.assertEqual(self.bucket.available_tokens, 7000)

    def test_final_id_still_prevents_reuse(self):
        self.bucket.reserve('a', 3000)
        self.bucket.settle('a', 0)
        self.assertFalse(self.bucket.reserve('a', 3000).allowed)
        self.assertEqual(self.bucket.available_tokens, 10000)

    def test_underestimate_creates_debt_and_waits_for_full_amount(self):
        self.bucket.reserve('a', 3000)
        result = self.bucket.settle('a', 12000)
        self.assertEqual(result.debited_tokens, 9000)
        self.assertEqual(self.bucket.available_tokens, -2000)
        decision = self.bucket.reserve('b', 1000)
        self.assertEqual(decision.wait_seconds, 3)
        self.now = 3
        self.assertTrue(self.bucket.reserve('b', 1000).allowed)

    def test_retry_after_rounds_up(self):
        self.bucket.reserve('a', 9200)
        decision = self.bucket.reserve('b', 7001)
        self.assertAlmostEqual(decision.wait_seconds, 6.201)
        self.assertEqual(decision.retry_after, 7)

    def test_unknown_usage_keeps_charge_and_can_be_reconciled(self):
        self.bucket.reserve('a', 3000)
        result = self.bucket.mark_unknown('a', 500)
        self.assertIsNone(result.actual_tokens)
        self.assertEqual(result.status, 'unknown')
        self.assertEqual(self.bucket.available_tokens, 7000)
        self.assertTrue(self.bucket.mark_unknown('a', 500).replayed)
        result = self.bucket.settle('a', 1200)
        self.assertEqual(result.credited_tokens, 1800)
        self.assertEqual(self.bucket.available_tokens, 8800)

    def test_unknown_partial_above_estimate_is_charged(self):
        self.bucket.reserve('a', 3000)
        result = self.bucket.mark_unknown('a', 5000)
        self.assertEqual(result.debited_tokens, 2000)
        self.assertEqual(self.bucket.available_tokens, 5000)
        with self.assertRaises(ValueError):
            self.bucket.settle('a', 4000)
        self.assertEqual(self.bucket.available_tokens, 5000)
        self.bucket.settle('a', 6000)
        self.assertEqual(self.bucket.available_tokens, 4000)

    def test_unknown_cannot_overwrite_final_or_conflicting_partial(self):
        self.bucket.reserve('a', 3000)
        self.bucket.mark_unknown('a', 500)
        with self.assertRaises(ValueError):
            self.bucket.mark_unknown('a', 600)
        self.bucket.settle('a', 1000)
        with self.assertRaises(ValueError):
            self.bucket.mark_unknown('a', 500)

    def test_late_refund_cannot_create_second_burst(self):
        self.bucket.reserve('old', 8000)
        self.now = 8
        self.bucket.reserve('new', 10000)
        self.now = 8.1
        result = self.bucket.settle('old', 1000)
        self.assertEqual(result.credited_tokens, 0)
        self.assertAlmostEqual(self.bucket.available_tokens, 100)
        self.assertFalse(self.bucket.reserve('extra', 7000).allowed)
        self.assertEqual(result.actual_tokens, 1000)

    def test_partial_refill_limits_refund(self):
        self.bucket.reserve('a', 8000)
        self.now = 4
        self.bucket.reserve('b', 6000)
        result = self.bucket.settle('a', 1000)
        self.assertEqual(result.credited_tokens, 4000)
        self.assertEqual(self.bucket.available_tokens, 4000)

    def test_late_extra_usage_is_charged_once(self):
        self.bucket.reserve('a', 3000)
        self.now = 10
        self.bucket.reserve('b', 10000)
        self.bucket.settle('a', 5000)
        self.assertEqual(self.bucket.available_tokens, -2000)
        self.bucket.settle('a', 5000)
        self.assertEqual(self.bucket.available_tokens, -2000)

    def test_unknown_is_not_a_permanent_rate_freeze(self):
        self.bucket.reserve('a', 10000)
        self.bucket.mark_unknown('a')
        self.now = 10
        self.assertEqual(self.bucket.available_tokens, 10000)
        self.assertFalse(self.bucket.reserve('a', 10000).allowed)

    def test_unknown_reservation_cannot_be_settled(self):
        with self.assertRaises(KeyError):
            self.bucket.settle('missing', 0)
        with self.assertRaises(KeyError):
            self.bucket.mark_unknown('missing')
        self.assertEqual(self.bucket.available_tokens, 10000)

    def test_invalid_counts_do_not_change_balance(self):
        for value in [-1, 0, 1.5, True, float('nan'), float('inf'), 2**53]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.bucket.reserve('a', value)
        self.assertEqual(self.bucket.available_tokens, 10000)
        self.bucket.reserve('a', 1000)
        for value in [-1, None, 0.5, True, float('nan')]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.bucket.settle('a', value)
        self.assertEqual(self.bucket.available_tokens, 9000)

    def test_invalid_configuration_and_id(self):
        for value in [0, -1, float('nan'), float('inf'), True]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                TokenBucket(value)
            with self.subTest(burst=value), self.assertRaises(ValueError):
                TokenBucket(60000, burst_seconds=value)
        for value in [None, '', ' ', 7]:
            with self.subTest(id=value), self.assertRaises(ValueError):
                self.bucket.reserve(value, 1000)

    def test_clock_must_be_monotonic_and_finite(self):
        self.now = -1
        with self.assertRaises(ValueError):
            self.bucket.reserve('a', 1000)
        self.now = float('nan')
        with self.assertRaises(ValueError):
            self.bucket.reserve('a', 1000)
        self.now = 0
        self.assertEqual(self.bucket.available_tokens, 10000)

    def test_record_limit_preserves_idempotency(self):
        bucket = TokenBucket(60000, clock=lambda: 0, max_records=1)
        bucket.reserve('a', 1000)
        bucket.settle('a', 0)
        self.assertEqual(bucket.reserve('b', 1000).status, 'record_limit')
        self.assertEqual(bucket.reserve('a', 1000).status, 'replayed')

    def test_concurrent_reservations_do_not_oversubscribe(self):
        with ThreadPoolExecutor(max_workers=20) as pool:
            decisions = list(pool.map(lambda i: self.bucket.reserve(str(i), 1000), range(40)))
        self.assertEqual(sum(d.allowed for d in decisions), 10)
        self.assertEqual(self.bucket.available_tokens, 0)

    def test_concurrent_duplicate_settlements_refund_once(self):
        self.bucket.reserve('a', 3000)
        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(lambda _: self.bucket.settle('a', 1200), range(40)))
        self.assertEqual(sum(not r.replayed for r in results), 1)
        self.assertEqual(self.bucket.available_tokens, 8800)


if __name__ == '__main__':
    unittest.main()
