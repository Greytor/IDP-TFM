"""Utilidades numéricas compartidas por los modelos de proceso."""
import random


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def lag(current: float, target: float, tau_s: float, dt_s: float) -> float:
    """Filtro de primer orden: current se acerca a target con constante de tiempo tau_s."""
    if tau_s <= 0:
        return target
    a = dt_s / (tau_s + dt_s)
    return current + a * (target - current)


def noise(amplitude: float) -> float:
    """Ruido uniforme centrado en 0."""
    return random.uniform(-amplitude, amplitude)


class RandomWalk:
    """Deriva lenta dentro de [lo, hi] — para variables que fluctúan sin
    dinámica propia (factor de velocidad de línea, tensión de red, densidad)."""

    def __init__(self, value: float, lo: float, hi: float, step: float):
        self.value = value
        self.lo = lo
        self.hi = hi
        self.step = step

    def tick(self) -> float:
        self.value = clamp(self.value + random.uniform(-self.step, self.step), self.lo, self.hi)
        return self.value
