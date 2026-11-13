"""Bounded, request-scoped pseudonymization for a trusted plain-text display.

Teaching example only: three ASCII-oriented recognizers, no authentication engine,
no Markdown/HTML/URL/tool-argument restoration, and no complete PII/secret detector.
Scope and RestoreGrant MUST come from trusted application authorization, never from
model output or client claims. Each instance handles one input and one output field.
"""
from dataclasses import dataclass
import re
import secrets


class ProtectionError(ValueError):
    """A policy, input, lifecycle, or stream boundary was not satisfied."""


@dataclass(frozen=True)
class Scope:
    tenant_id: str
    request_id: str
    recipient_id: str


@dataclass(frozen=True)
class RestoreGrant:
    scope: Scope
    sink: str
    allowed_tokens: frozenset[str]


# Detection examples, not complete validators or a complete sensitive-data catalog.
PATTERNS = (
    ("EMAIL", re.compile(r"(?<![A-Za-z0-9_.+-])[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?![A-Za-z0-9-])")),
    ("IDCARD", re.compile(r"(?<![0-9])[0-9]{17}[0-9Xx](?![0-9])")),
    ("PHONE", re.compile(r"(?<![0-9])1[3-9][0-9]{9}(?![0-9])")),
)


class Pseudonymizer:
    """Single request, single input, single trusted plain-text output field.

    close() drops this object's references; it is not secure memory erasure.
    The caller still owns its original text and any restored output.
    """

    def __init__(self, scope, *, max_input_chars=32768, max_spans=256,
                 max_stream_chars=65536, max_restored_chars=65536):
        if not isinstance(scope, Scope) or not all(
            isinstance(x, str) and x for x in
            (scope.tenant_id, scope.request_id, scope.recipient_id)
        ):
            raise ProtectionError("invalid trusted scope")
        limits = (max_input_chars, max_spans, max_stream_chars, max_restored_chars)
        if any(type(x) is not int or x <= 0 for x in limits):
            raise ProtectionError("limits must be positive integers")
        self.scope = scope
        self.max_input_chars, self.max_spans = max_input_chars, max_spans
        self.max_stream_chars, self.max_restored_chars = max_stream_chars, max_restored_chars
        self._nonce = secrets.token_hex(12)
        self._backward = {}
        self._masked = False
        self._closed = False
        self._stream = None

    def _check_open(self):
        if self._closed:
            raise ProtectionError("request scope is closed")

    @property
    def tokens(self):
        self._check_open()
        return tuple(self._backward)

    def mask(self, text):
        self._check_open()
        if self._masked:
            raise ProtectionError("only one input is supported")
        if not isinstance(text, str) or len(text) > self.max_input_chars:
            raise ProtectionError("invalid or oversized input")
        # Reserving both delimiters avoids collisions with user-supplied markers.
        # A production application may instead use a well-defined escaping layer.
        if "⟦" in text or "⟧" in text:
            raise ProtectionError("input contains reserved placeholder delimiters")
        candidates = []
        for priority, (kind, pattern) in enumerate(PATTERNS):
            for match in pattern.finditer(text):
                candidates.append((match.start(), match.end(), priority, kind))
                if len(candidates) > self.max_spans * len(PATTERNS):
                    raise ProtectionError("too many candidate spans")
        # Detect on the original input once. Prefer the longest covering entity,
        # then a deterministic recognizer priority; never re-scan replaced text.
        selected = []
        for span in sorted(candidates, key=lambda s: (-(s[1]-s[0]), s[2], s[0])):
            if not any(span[0] < other[1] and other[0] < span[1] for other in selected):
                selected.append(span)
                if len(selected) > self.max_spans:
                    raise ProtectionError("too many entity spans")
        forward, pieces, cursor = {}, [], 0
        for start, end, _, kind in sorted(selected):
            value = text[start:end]
            key = (kind, value)
            token = forward.get(key)
            if token is None:
                token = f"⟦PII:{self._nonce}:{kind}:{len(forward)+1}⟧"
                forward[key] = token
                self._backward[token] = value
            pieces.extend((text[cursor:start], token))
            cursor = end
        pieces.append(text[cursor:])
        self._masked = True
        return "".join(pieces)

    def restorer(self, grant):
        self._check_open()
        if not self._masked or self._stream is not None:
            raise ProtectionError("restorer requires one masked input and one output field")
        if not isinstance(grant, RestoreGrant) or grant.scope != self.scope:
            raise ProtectionError("restoration scope mismatch")
        if grant.sink != "trusted_plain_text":
            raise ProtectionError("restoration is restricted to trusted plain-text display")
        if not isinstance(grant.allowed_tokens, frozenset) or not grant.allowed_tokens <= self._backward.keys():
            raise ProtectionError("grant contains unknown placeholders")
        self._stream = _PlainTextRestorer(self, grant.allowed_tokens)
        return self._stream

    def close(self):
        if self._stream is not None:
            self._stream.abort()
        self._backward.clear()
        self._nonce = ""
        self._closed = True

    def __enter__(self):
        self._check_open()
        return self

    def __exit__(self, *_):
        self.close()


class _PlainTextRestorer:
    """Incremental parser for already-decoded text, never raw SSE/JSON bytes.

    Pending state must remain a prefix of an existing request token, so it is
    bounded by token length. Errors terminate the field without flushing pending
    text. A previously returned chunk cannot be recalled.
    """

    def __init__(self, owner, allowed):
        self._owner, self._allowed = owner, allowed
        self._pending = ""
        self._seen = self._emitted = 0
        self._done = False

    def _check_open(self):
        self._owner._check_open()
        if self._done:
            raise ProtectionError("output field is closed")

    def feed(self, chunk):
        self._check_open()
        try:
            if not isinstance(chunk, str) or self._seen + len(chunk) > self._owner.max_stream_chars:
                raise ProtectionError("invalid or oversized output")
            self._seen += len(chunk)
            output = []
            output_size = 0
            for char in chunk:
                piece = ""
                if self._pending or char == "⟦":
                    self._pending += char
                    if char == "⟧":
                        token = self._pending
                        if token not in self._owner._backward:
                            raise ProtectionError("unknown or malformed placeholder")
                        if token not in self._allowed:
                            raise ProtectionError("placeholder is not authorized for this recipient")
                        piece = self._owner._backward[token]
                        self._pending = ""
                    elif not any(t.startswith(self._pending) for t in self._owner._backward):
                        raise ProtectionError("unknown or malformed placeholder")
                elif char == "⟧":
                    raise ProtectionError("unexpected placeholder delimiter")
                else:
                    piece = char
                output_size += len(piece)
                if self._emitted + output_size > self._owner.max_restored_chars:
                    raise ProtectionError("restored output exceeds limit")
                output.append(piece)
            result = "".join(output)
            self._emitted += output_size
            return result
        except ProtectionError:
            self.abort()
            raise

    def finish(self):
        self._check_open()
        if self._pending:
            self.abort()
            raise ProtectionError("incomplete placeholder at end of stream")
        self._done = True
        return ""

    def abort(self):
        self._pending = ""
        self._done = True
