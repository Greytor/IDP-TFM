"""Canal interno de causalidad de la celda.

Los simuladores esclavos (válvula, coriolis, medidor) consultan GET /state
del PLC maestro para derivar su propia física. Si el PLC no responde, el
enlace degrada a "línea parada" (ok=False) y cada dispositivo lo señaliza
por su protocolo (status word / PlcLinkOk) para que Node-RED publique
q=uncertain en el UNS.

Este canal es un artefacto de la simulación — NO forma parte del UNS ni de
la superficie de integración; solo existe dentro de la red del compose.
"""
import asyncio
import logging
import os

import aiohttp

log = logging.getLogger("plc_link")

PLC_STATE_URL = os.environ.get("PLC_STATE_URL", "http://plc-llenado:8080/state")
POLL_PERIOD_S = float(os.environ.get("PLC_POLL_PERIOD_S", "0.5"))

FALLBACK_STATE = {
    "state": 0,
    "state_text": "STOPPED",
    "running": False,
    "target_flow_kgh": 0.0,
    "valve_cmd_pct": 0.0,
    "speed_bpm": 0.0,
    "good_count": 0,
    "bad_count": 0,
    "alarm_jam": False,
}


class PlcLink:
    def __init__(self, url: str = PLC_STATE_URL, period_s: float = POLL_PERIOD_S):
        self.url = url
        self.period_s = period_s
        self.state: dict = dict(FALLBACK_STATE)
        self.ok = False

    async def run(self) -> None:
        timeout = aiohttp.ClientTimeout(total=1.0)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            while True:
                try:
                    async with session.get(self.url) as resp:
                        resp.raise_for_status()
                        self.state = await resp.json()
                    if not self.ok:
                        log.info("Enlace con PLC maestro OK (%s)", self.url)
                    self.ok = True
                except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
                    if self.ok:
                        log.warning("PLC maestro no responde (%s): %s — degradando a línea parada", self.url, e)
                    self.ok = False
                    self.state = dict(FALLBACK_STATE)
                await asyncio.sleep(self.period_s)
