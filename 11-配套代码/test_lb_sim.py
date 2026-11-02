import unittest
from lb_sim import POLICIES, output_load, run, workload


class SimulationTests(unittest.TestCase):
    def test_censored_request_is_observed_after_arrival_window(self):
        r = run('rr', [1], [(0.99, 2000, 2, 2)], 1, 1, warmup=0)
        self.assertEqual(r['horizon']['eligible_without_first_token'], 1)
        self.assertEqual(r['n'], 1)
        self.assertAlmostEqual(r['p99'], .3, places=6)
        self.assertGreater(r['drained_at'], 1)

    def test_queued_tail_is_not_dropped(self):
        reqs = [(0, 1000, 20, 20), (.1, 1000, 20, 20), (.2, 1000, 20, 20)]
        r = run('rr', [1], reqs, .3, 1, B=1, warmup=0)
        self.assertEqual((r['n'], r['completed']), (3, 3))
        self.assertEqual(r['horizon']['eligible_without_first_token'], 2)
        self.assertGreater(r['p90'], .3)

    def test_warmup_by_arrival_and_first_token_counts_toward_output(self):
        r = run('rr', [1], [(0, 1, 1, 1), (.5, 1, 1, 1)], 1, 1, warmup=.5)
        self.assertEqual((r['eligible'], r['n'], r['completed']), (1, 1, 2))
        self.assertAlmostEqual(r['p99'], .00015)

    def test_drain_limit_fails_instead_of_reporting_partial_p99(self):
        with self.assertRaises(RuntimeError):
            run('rr', [1], [(0, 16000, 4000, 4000)], 1, 1, warmup=0, max_drain=0)

    def test_progress_and_estimation_are_separate(self):
        req = {'out': 100, 'rem': 10, 'est': 120}
        self.assertEqual(output_load([req], 'initial_tok'), 120)
        self.assertEqual(output_load([req], 'remaining_tok'), 30)
        self.assertEqual(output_load([req], 'remaining_tok_oracle'), 10)
        req['est'] = 50
        self.assertEqual(output_load([req], 'remaining_tok'), 1)

    def test_all_policies_share_samples_and_preserve_workload(self):
        reqs = workload(7, 3, 3)
        original = list(reqs)
        rows = [run(p, [1, 1, 1, .6], reqs, 3, 7, warmup=0) for p in POLICIES]
        self.assertEqual(reqs, original)
        self.assertEqual(len({r['workload_sha256'] for r in rows}), 1)
        self.assertTrue(all(r['n'] == len(reqs) == r['completed'] for r in rows))
        self.assertEqual(rows[0], run('rr', [1, 1, 1, .6], reqs, 3, 7, warmup=0))

    def test_weighted_round_robin_matches_capacity_shares(self):
        reqs = [(0, 1, 1, 1)] * 180
        weighted = run('weighted_rr', [1, 1, 1, .6], reqs, 1, 1, warmup=0)
        equal = run('rr', [1, 1, 1, .6], reqs, 1, 1, warmup=0)
        self.assertEqual(weighted['assigned'], [50, 50, 50, 30])
        self.assertEqual(equal['assigned'], [45, 45, 45, 45])


if __name__ == '__main__':
    unittest.main()
