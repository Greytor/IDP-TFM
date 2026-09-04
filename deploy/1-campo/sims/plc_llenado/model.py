"""Modelo de la línea de llenado (celda F&B).

Máquina de estados con calendario de producción autónomo:

    STOPPED ──▶ STARTING ──▶ RUNNING ──▶ STOPPED  (fin de corrida / changeover)
                    ▲            │
                    └── FAULT ◀──┘   (atasco aleatorio, MTBF ≈ 20 min)

En RUNNING cuenta botellas buenas/malas — con episodios de mala calidad de
1-5 min — de forma que aguas abajo se puedan derivar disponibilidad y
calidad (OEE) a partir de estados y contadores. El PLC comanda la válvula
con característica instalada lineal: valve_cmd_pct = 100·target_flow/MAX_FLOW.

En modo manual (Cmd.AutoMode=False por OPC UA) el calendario se suspende y
la línea obedece los pulsos Cmd.Start/Cmd.Stop y el setpoint Cmd.TargetFlowKgh.
"""
import random

from ..common.model_utils import RandomWalk, clamp, lag

STOPPED, STARTING, RUNNING, FAULT = 0, 1, 2, 3
STATE_TEXT = {STOPPED: "STOPPED", STARTING: "STARTING", RUNNING: "RUNNING", FAULT: "FAULT"}

NOMINAL_FLOW_KGH = 1200.0  # llenadora a velocidad nominal
MAX_FLOW_KGH = 1500.0      # caudal con válvula 100% abierta
BOTTLE_KG = 0.5            # botella de 500 ml


class FillingLine:
    def __init__(self) -> None:
        self.state = STOPPED
        self.state_timer_s = random.uniform(20, 60)  # primer arranque rápido para la demo
        self.speed_factor = RandomWalk(0.92, 0.85, 1.0, 0.002)
        self.target_flow_kgh = 0.0
        self.valve_cmd_pct = 0.0
        self.speed_bpm = 0.0
        self.good_count = 0
        self.bad_count = 0
        self.alarm_jam = False
        self.auto_mode = True
        self.uptime_s = 0.0
        self._bottle_carry = 0.0
        self._quality_episode_s = 0.0
        self._manual_flow_kgh = 0.0

    def tick(self, dt: float, manual: dict | None = None) -> None:
        """Avanza el modelo dt segundos. manual=None → calendario automático."""
        self.uptime_s += dt
        self.state_timer_s -= dt
        self._manual_flow_kgh = (manual or {}).get("target_flow_kgh", 0.0)

        # volvió a modo automático desde manual: reprograma el calendario
        if manual is None and self.state_timer_s == float("-inf"):
            self.state_timer_s = random.uniform(60, 300)

        # atasco aleatorio durante producción
        if self.state == RUNNING and random.random() < dt / 1200.0:
            self._enter(FAULT, random.uniform(60, 240))

        if manual is not None:
            self._manual_transitions(manual)
        elif self.state_timer_s <= 0:
            self._auto_transition()

        # consigna de caudal: rampa suave (lag) hacia el objetivo del estado
        if self.state in (STARTING, RUNNING):
            if self.state == RUNNING:
                self.speed_factor.tick()
            nominal = (self._manual_flow_kgh
                       if manual is not None and self._manual_flow_kgh > 0
                       else NOMINAL_FLOW_KGH * self.speed_factor.value)
            target = clamp(nominal, 0.0, MAX_FLOW_KGH * 0.95)
        else:
            target = 0.0
        self.target_flow_kgh = lag(self.target_flow_kgh, target, tau_s=8.0, dt_s=dt)
        if target == 0.0 and self.target_flow_kgh < 1.0:
            self.target_flow_kgh = 0.0

        self.valve_cmd_pct = clamp(100.0 * self.target_flow_kgh / MAX_FLOW_KGH, 0.0, 100.0)

        if self.state == RUNNING:
            self.speed_bpm = self.target_flow_kgh / 60.0 / BOTTLE_KG
            self._count_bottles(dt)
        else:
            self.speed_bpm = 0.0

        self.alarm_jam = self.state == FAULT

    # ── transiciones ─────────────────────────────────────────────────────────

    def _enter(self, state: int, dur_s: float) -> None:
        self.state = state
        self.state_timer_s = dur_s

    def _auto_transition(self) -> None:
        if self.state == STOPPED:
            self._enter(STARTING, random.uniform(20, 40))
        elif self.state == STARTING:
            self._enter(RUNNING, random.uniform(600, 1800))   # corrida de 10-30 min
        elif self.state == RUNNING:
            self._enter(STOPPED, random.uniform(120, 480))    # changeover de 2-8 min
        elif self.state == FAULT:
            self._enter(STARTING, random.uniform(20, 40))     # atasco despejado

    def _manual_transitions(self, manual: dict) -> None:
        # -inf como timer = "espera comando" (nunca expira; se detecta al volver a auto)
        if manual.get("stop") and self.state != STOPPED:
            self._enter(STOPPED, float("-inf"))
        elif manual.get("start") and self.state == STOPPED:
            self._enter(STARTING, random.uniform(20, 40))
        elif self.state_timer_s <= 0:
            if self.state == STARTING:
                self._enter(RUNNING, float("-inf"))  # en manual corre hasta recibir stop
            elif self.state == FAULT:
                self._enter(STARTING, random.uniform(20, 40))

    # ── producción y calidad ─────────────────────────────────────────────────

    def _count_bottles(self, dt: float) -> None:
        if self._quality_episode_s > 0:
            self._quality_episode_s -= dt
            bad_p = 0.12
        else:
            if random.random() < dt / 3600.0:  # ~1 episodio de calidad por hora
                self._quality_episode_s = random.uniform(60, 300)
            bad_p = 0.015

        self._bottle_carry += self.speed_bpm * dt / 60.0
        while self._bottle_carry >= 1.0:
            self._bottle_carry -= 1.0
            if random.random() < bad_p:
                self.bad_count += 1
            else:
                self.good_count += 1
