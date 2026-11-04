"""第 12 讲：单进程、按预估用量准入的教学令牌桶。

本例不是厂商限流仿真或费用账本。预留必须足额；最终补扣可产生欠额。
旧扣减被速率补充恢复后不再退款。记录保留到实例结束，有数量上限。
"""
from collections import deque
from dataclasses import dataclass, field, replace
import math
import threading
import time
from typing import Optional


@dataclass(frozen=True)
class Admission:
    status: str
    wait_seconds: Optional[float] = None

    @property
    def allowed(self):
        # replayed 表示已有预留，不得据此再次派发上游。
        return self.status == "reserved"

    @property
    def retry_after(self):
        return None if self.wait_seconds is None else math.ceil(self.wait_seconds)


@dataclass(frozen=True)
class Settlement:
    status: str
    actual_tokens: Optional[int]
    observed_tokens: int
    credited_tokens: float
    debited_tokens: int
    replayed: bool = False


@dataclass
class _Charge:
    remaining: float


@dataclass
class _Reservation:
    estimate: int
    charged: int
    charges: list = field(default_factory=list)
    result: Optional[Settlement] = None


def _positive_number(value, name):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(name + " must be finite and positive") from None
    if isinstance(value, bool) or not math.isfinite(number) or number <= 0:
        raise ValueError(name + " must be finite and positive")
    return number


def _tokens(value, name, allow_zero=False):
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(name + " must be an integer")
    if value < (0 if allow_zero else 1) or value > 2**53 - 1:
        raise ValueError(name + " is out of range")
    return value


class TokenBucket:
    def __init__(self, tokens_per_minute, burst_seconds=60,
                 clock=time.monotonic, max_records=10000):
        self.rate = _positive_number(tokens_per_minute, "tokens_per_minute") / 60
        self.capacity = self.rate * _positive_number(burst_seconds, "burst_seconds")
        if not math.isfinite(self.capacity) or not 1 <= self.capacity <= 2**53 - 1:
            raise ValueError("capacity must be between 1 and 2**53 - 1")
        self.max_records = _tokens(max_records, "max_records")
        self.clock = clock
        self.updated = self._now()
        self._level = self.capacity
        self._records = {}
        self._charges = deque()
        self._lock = threading.Lock()

    def _now(self):
        now = float(self.clock())
        if not math.isfinite(now):
            raise ValueError("clock must be finite")
        return now

    def _refill(self):
        now = self._now()
        if now < self.updated:
            raise ValueError("clock must not move backwards")
        amount = min(self.capacity - self._level, (now - self.updated) * self.rate)
        self.updated = now
        self._level += amount
        # 按扣减顺序消化补充量，追踪每次扣减尚未恢复的部分。
        while self._charges and (amount > 0 or self._charges[0].remaining == 0):
            charge = self._charges[0]
            used = min(amount, charge.remaining)
            charge.remaining -= used
            amount -= used
            if charge.remaining == 0:
                self._charges.popleft()

    def _charge(self, record, amount):
        if amount:
            charge = _Charge(float(amount))
            record.charges.append(charge)
            self._charges.append(charge)
            self._level -= amount

    def _refund(self, record, amount):
        # 只退本次预留尚未恢复的扣减，不拿其他请求的扣减抵退款。
        returned = 0.0
        for charge in reversed(record.charges):
            credit = min(amount - returned, charge.remaining)
            charge.remaining -= credit
            returned += credit
            if returned == amount:
                break
        self._level = min(self.capacity, self._level + returned)
        while self._charges and self._charges[0].remaining == 0:
            self._charges.popleft()
        return returned

    def reserve(self, reservation_id, estimated_tokens):
        """新编号准入；超大请求不返回虚假的等待时间。"""
        if not isinstance(reservation_id, str) or not reservation_id.strip():
            raise ValueError("reservation_id must be a non-empty string")
        estimate = _tokens(estimated_tokens, "estimated_tokens")
        with self._lock:
            self._refill()
            previous = self._records.get(reservation_id)
            if previous is not None:
                if previous.estimate != estimate:
                    raise ValueError("reservation_id reused with a different estimate")
                return Admission("replayed")
            if estimate > self.capacity:
                return Admission("oversized")
            if len(self._records) >= self.max_records:
                return Admission("record_limit")
            if self._level < estimate:
                return Admission("limited", (estimate - self._level) / self.rate)
            record = _Reservation(estimate, estimate)
            self._charge(record, estimate)
            self._records[reservation_id] = record
            return Admission("reserved")

    def mark_unknown(self, reservation_id, observed_tokens=0):
        """调用结束但缺最终用量：保留预扣，不按部分值退款。

        observed_tokens 是同一口径下已确认的累计部分值；超预扣时补扣。
        本方法一次性记录结束时的部分值，后续用最终实报值调用 settle。
        """
        observed = _tokens(observed_tokens, "observed_tokens", allow_zero=True)
        with self._lock:
            record = self._records[reservation_id]
            if record.result is not None:
                if record.result.status == "unknown" and record.result.observed_tokens == observed:
                    return replace(record.result, replayed=True)
                raise ValueError("unknown result conflicts with existing result")
            self._refill()
            debit = max(0, observed - record.charged)
            self._charge(record, debit)
            record.charged += debit
            record.result = Settlement("unknown", None, observed, 0.0, debit)
            return record.result

    def settle(self, reservation_id, actual_tokens):
        """最终实报值结算；相同重放无副作用，冲突值报错。"""
        actual = _tokens(actual_tokens, "actual_tokens", allow_zero=True)
        with self._lock:
            record = self._records[reservation_id]
            previous = record.result
            if previous is not None and previous.status == "final":
                if previous.actual_tokens != actual:
                    raise ValueError("conflicting final usage")
                return replace(previous, replayed=True)
            observed = previous.observed_tokens if previous is not None else 0
            if actual < observed:
                raise ValueError("final usage is below confirmed partial usage")
            self._refill()
            debit = max(0, actual - record.charged)
            self._charge(record, debit)
            credit = self._refund(record, max(0, record.charged - actual))
            record.charged += debit
            record.result = Settlement("final", actual, observed, credit, debit)
            return record.result

    @property
    def available_tokens(self):
        with self._lock:
            self._refill()
            return self._level


def demo():
    now = [0.0]
    bucket = TokenBucket(60000, burst_seconds=10, clock=lambda: now[0])
    print("reserve A:", bucket.reserve("A", 3000).status)
    result = bucket.settle("A", 1200)
    print(f"settle A: credit={result.credited_tokens:.0f}, available={bucket.available_tokens:.0f}")
    print("settle A again: replayed=", bucket.settle("A", 1200).replayed, sep="")
    print("reserve oversized:", bucket.reserve("large", 15000).status)
    bucket.reserve("B", 8000)
    decision = bucket.reserve("C", 7001)
    print(f"reserve C: {decision.status}, wait={decision.wait_seconds:.3f}s, Retry-After={decision.retry_after}")
    bucket.mark_unknown("B", 500)
    print(f"B usage unknown: available={bucket.available_tokens:.0f}")
    now[0] = 10.0
    result = bucket.settle("B", 1000)
    print(f"late settle B: actual={result.actual_tokens}, credit={result.credited_tokens:.0f}")


if __name__ == "__main__":
    demo()
