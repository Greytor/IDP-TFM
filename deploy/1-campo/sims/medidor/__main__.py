"""Medidor de energía de la celda (Modbus TCP :5021, FC4 input registers).

Convención estilo Eastron SDM: floats de 32 bits en input registers.
Potencia activa = consumo base de la celda (controles/HMI) + carga de la
llenadora según estado y velocidad de línea + compresor de aire con ciclo
de trabajo. energy_kwh es acumulador y nunca se resetea, como el registro
de un medidor real — el consumo por período lo calcula el consumidor.

Mapa de registros: ver README.md. Status word (addr 12): bit0=enlace PLC ok
(sin enlace, el medidor reporta consumo de standby: dato plausible pero sin
contexto → q=uncertain en el UNS).
"""
import asyncio
import logging
import os
import random

from pymodbus.datastore import ModbusSequentialDataBlock, ModbusServerContext, ModbusSlaveContext
from pymodbus.server import StartAsyncTcpServer

from ..common.model_utils import RandomWalk, clamp, noise
from ..common.plc_link import PlcLink
from ..common.registers import f32_to_regs, pack_bits

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("pymodbus").setLevel(logging.WARNING)
log = logging.getLogger("medidor")

MODBUS_PORT = int(os.environ.get("MODBUS_PORT", "5021"))
TICK_S = 1.0
NOMINAL_BPM = 40.0  # botellas/min a caudal nominal (1200 kg/h ÷ 60 ÷ 0.5 kg)

# códigos de estado del PLC maestro
ST_STARTING, ST_RUNNING, ST_FAULT = 1, 2, 3

FC_IR = 4


async def update_loop(context: ModbusServerContext, plc: PlcLink) -> None:
    volt_walk = RandomWalk(230.0, 224.0, 236.0, 0.15)
    energy_kwh = 0.0
    comp_on = False
    comp_timer_s = 0.0

    while True:
        st = plc.state
        state = int(st.get("state", 0)) if plc.ok else 0
        speed_bpm = float(st.get("speed_bpm", 0.0)) if plc.ok else 0.0

        power_w = 350.0  # base: controles, HMI, red
        if state == ST_STARTING:
            power_w += 900.0                                    # motores en vacío
        elif state == ST_RUNNING:
            power_w += 900.0 + 2200.0 * speed_bpm / NOMINAL_BPM  # llenadora a carga
        elif state == ST_FAULT:
            power_w += 600.0                                    # motores parados, baliza

        # compresor de aire: ciclo on/off, mucho más activo con la línea corriendo
        comp_timer_s -= TICK_S
        if comp_timer_s <= 0:
            comp_on = not comp_on
            if comp_on:
                comp_timer_s = random.uniform(30, 60)
            else:
                comp_timer_s = random.uniform(60, 120) if state == ST_RUNNING else random.uniform(300, 600)
        if comp_on:
            power_w += 800.0
        power_w += noise(15.0)

        voltage = volt_walk.tick() + noise(0.3)
        pf = clamp((0.87 if state == ST_RUNNING else 0.62) + noise(0.02), 0.3, 1.0)
        current = power_w / (voltage * pf)
        freq = 50.0 + noise(0.03)
        energy_kwh += power_w * TICK_S / 3.6e6

        regs = (
            f32_to_regs(voltage)     # 0-1   voltage_v
            + f32_to_regs(current)   # 2-3   current_a
            + f32_to_regs(power_w)   # 4-5   active_power_w
            + f32_to_regs(pf)        # 6-7   power_factor
            + f32_to_regs(freq)      # 8-9   frequency_hz
            + f32_to_regs(energy_kwh)  # 10-11 energy_kwh
        )
        regs.append(pack_bits(plc.ok))  # 12 status_word
        context[0x00].setValues(FC_IR, 0, regs)

        await asyncio.sleep(TICK_S)


async def main() -> None:
    plc = PlcLink()
    store = ModbusSlaveContext(
        hr=ModbusSequentialDataBlock(0, [0] * 16),
        ir=ModbusSequentialDataBlock(0, [0] * 16),
        zero_mode=True,
    )
    context = ModbusServerContext(slaves=store, single=True)

    log.info("Modbus TCP en :%d (FC4, float32 BE)", MODBUS_PORT)
    await asyncio.gather(
        plc.run(),
        update_loop(context, plc),
        StartAsyncTcpServer(context=context, address=("0.0.0.0", MODBUS_PORT)),
    )


if __name__ == "__main__":
    asyncio.run(main())
