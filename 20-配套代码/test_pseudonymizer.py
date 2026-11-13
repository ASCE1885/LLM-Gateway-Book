"""Offline regression tests with synthetic principals and data only."""
import unittest
from dataclasses import replace
from pseudonymizer import ProtectionError, Pseudonymizer, RestoreGrant, Scope


SCOPE = Scope("tenant-a", "request-a", "user-a")
PHONE = "13812345678"
EMAIL = "person@example.com"


def grant(p, **changes):
    return replace(RestoreGrant(p.scope, "trusted_plain_text", frozenset(p.tokens)), **changes)


class PseudonymizerTests(unittest.TestCase):
    def make(self, text=PHONE, **limits):
        p = Pseudonymizer(SCOPE, **limits)
        self.addCleanup(p.close)
        masked = p.mask(text)
        return p, masked

    def test_repeated_value_keeps_one_token(self):
        p, masked = self.make(f"{PHONE} / {PHONE}")
        self.assertEqual(len(p.tokens), 1)
        self.assertEqual(masked.count(p.tokens[0]), 2)
        s = p.restorer(grant(p))
        self.assertEqual(s.feed(masked) + s.finish(), f"{PHONE} / {PHONE}")

    def test_overlapping_phone_in_email_is_one_email(self):
        value = PHONE + "@example.com"
        p, masked = self.make(value + "; " + PHONE)
        self.assertEqual(len(p.tokens), 2)
        self.assertNotIn("example.com", masked)
        self.assertIn(":EMAIL:", p.tokens[0])
        s = p.restorer(grant(p))
        self.assertEqual(s.feed(masked) + s.finish(), value + "; " + PHONE)

    def test_email_does_not_absorb_sentence_period(self):
        p, masked = self.make(EMAIL + ".")
        self.assertTrue(masked.endswith("⟧."))

    def test_every_two_chunk_split(self):
        # Token length is fixed for this value; cover all cuts, including delimiters.
        for cut in range(50):
            with self.subTest(cut=cut):
                p, masked = self.make(PHONE)
                value = "联系 " + masked + "。"
                s = p.restorer(grant(p))
                self.assertEqual(s.feed(value[:cut]) + s.feed(value[cut:]) + s.finish(), "联系 " + PHONE + "。")

    def test_one_character_chunks_and_multiple_entities(self):
        p, masked = self.make(PHONE + " " + EMAIL)
        s = p.restorer(grant(p))
        self.assertEqual("".join(s.feed(c) for c in masked) + s.finish(), PHONE + " " + EMAIL)

    def test_reserved_input_markers_rejected(self):
        for text in ("⟦PHONE_1⟧ " + PHONE, "⟦PII:fake:PHONE:1⟧", "⟦", "⟧"):
            with self.subTest(text=text), Pseudonymizer(SCOPE) as p:
                with self.assertRaises(ProtectionError):
                    p.mask(text)

    def test_scope_tenant_request_recipient_each_checked(self):
        p, _ = self.make()
        for field in ("tenant_id", "request_id", "recipient_id"):
            with self.subTest(field=field), self.assertRaises(ProtectionError):
                p.restorer(grant(p, scope=replace(SCOPE, **{field: "different"})))

    def test_url_markdown_and_tool_sinks_rejected(self):
        p, _ = self.make()
        for sink in ("url", "markdown", "html", "tool_arguments"):
            with self.subTest(sink=sink), self.assertRaises(ProtectionError):
                p.restorer(grant(p, sink=sink))

    def test_ungranted_known_value_cannot_be_restored(self):
        p, _ = self.make(PHONE + " " + EMAIL)
        s = p.restorer(grant(p, allowed_tokens=frozenset([p.tokens[0]])))
        with self.assertRaises(ProtectionError):
            s.feed(p.tokens[1])
        with self.assertRaises(ProtectionError):
            s.finish()

    def test_foreign_token_and_unknown_grant_rejected(self):
        p, _ = self.make()
        other, foreign = self.make()
        self.assertNotEqual(p.tokens, other.tokens)
        with self.assertRaises(ProtectionError):
            p.restorer(grant(p, allowed_tokens=frozenset(other.tokens)))
        s = p.restorer(grant(p))
        with self.assertRaises(ProtectionError):
            s.feed(foreign)

    def test_incomplete_token_not_flushed_at_end(self):
        p, token = self.make()
        s = p.restorer(grant(p))
        self.assertEqual(s.feed("联系 " + token[:-1]), "联系 ")
        with self.assertRaises(ProtectionError):
            s.finish()
        self.assertEqual(s._pending, "")

    def test_invalid_long_prefix_fails_without_retaining_tail(self):
        p, _ = self.make()
        s = p.restorer(grant(p))
        with self.assertRaises(ProtectionError):
            s.feed("⟦" + "x" * 10000)
        self.assertEqual(s._pending, "")
        with self.assertRaises(ProtectionError):
            s.feed("more")

    def test_output_input_limit_is_cumulative(self):
        p, _ = self.make(max_stream_chars=5)
        s = p.restorer(grant(p))
        self.assertEqual(s.feed("abc"), "abc")
        with self.assertRaises(ProtectionError):
            s.feed("def")

    def test_actual_restored_length_is_limited(self):
        p, token = self.make("long-address-for-teaching@example.com", max_restored_chars=10)
        s = p.restorer(grant(p))
        with self.assertRaises(ProtectionError):
            s.feed(token)

    def test_input_and_entity_count_limits_reject_without_truncation(self):
        with Pseudonymizer(SCOPE, max_input_chars=3) as p:
            with self.assertRaises(ProtectionError):
                p.mask("abcd")
        with Pseudonymizer(SCOPE, max_spans=1) as p:
            with self.assertRaises(ProtectionError):
                p.mask(PHONE + " " + EMAIL)

    def test_close_and_abort_release_references_and_disable_reuse(self):
        p, token = self.make()
        s = p.restorer(grant(p))
        s.feed(token[:8])
        p.close()
        self.assertEqual(p._backward, {})
        self.assertEqual(s._pending, "")
        with self.assertRaises(ProtectionError):
            s.feed(token[8:])
        with self.assertRaises(ProtectionError):
            p.mask(PHONE)

    def test_one_input_one_output_lifecycle(self):
        p, _ = self.make()
        with self.assertRaises(ProtectionError):
            p.mask(EMAIL)
        s = p.restorer(grant(p))
        with self.assertRaises(ProtectionError):
            p.restorer(grant(p))
        s.finish()
        with self.assertRaises(ProtectionError):
            s.feed("late")

    def test_plain_text_is_not_a_markup_sanitizer(self):
        p, token = self.make()
        s = p.restorer(grant(p))
        # The receiver MUST display this as literal text, never fetch this URL.
        text = "<img src='https://example.invalid/?v=" + token + "'>"
        restored = s.feed(text) + s.finish()
        self.assertIn(PHONE, restored)
        self.assertIn("<img", restored)


if __name__ == "__main__":
    unittest.main()
