"""Caudalímetro Coriolis (Modbus TCP :5020, FC3 holding registers).

Variables de proceso: caudal másico/volumétrico, densidad, temperatura del
fluido y totalizador. Diagnóstico NOA: drive gain, frecuencia de tubo,
temperatura del sensor y detección de aire arrastrado — el canal de salud
paralelo al lazo de control (patrón NOA, contrato UNS §4.5).

El caudal responde al mando de válvula del PLC maestro con su propio lag
(aproxima la posición real de la válvula sin depender del simulador de la
válvula). Durante STARTING hay probabilidad alta de slug de aire: el drive
gain se dispara y la densidad cae — la firma clásica de flujo en dos fases.

Mapa de registros (float32 BE, palabra alta primero): ver README.md.
Status word (addr 16): bit0=enlace PLC ok, bit1=aire arrastrado, bit2=fallo sensor.
"""
import asyncio
import logging
import os
import random

from pymodbus.datastore import ModbusSequentialDataBlock, ModbusServerContext, ModbusSlaveContext
from pymodbus.server import StartAsyncTcpServer

from ..common.model_utils import RandomWalk, clamp, lag, noise
from ..common.plc_link import PlcLink
from ..common.registers import f32_to_regs, pack_bits

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("pymodbus").setLevel(logging.WARNING)
log = logging.getLogger("coriolis")

MODBUS_PORT = int(os.environ.get("MODBUS_PORT", "5020"))
TICK_S = 0.5
MAX_FLOW_KGH = 1500.0  # caudal con válvula 100% abierta (mismo valor que el PLC)
PLC_STARTING = 1       # código de estado STARTING del PLC maestro
FC_HR = 3


async def update_loop(context: ModbusServerContext, plc: PlcLink) -> None:
    valve_est = 0.0
    total_kg = 0.0
    density_walk = RandomWalk(1042.0, 1038.0, 1046.0, 0.05)  # bebida azucarada ~1042 kg/m³
    temp_walk = RandomWalk(19.0, 17.0, 22.0, 0.01)
    air_timer_s = 0.0

    while True:
        st = plc.state
        cmd = float(st.get("valve_cmd_pct", 0.0)) if plc.ok else 0.0
        valve_est = lag(valve_est, cmd, tau_s=2.5, dt_s=TICK_S)

        # episodios de aire arrastrado: casi seguros en arranque, raros en régimen
        if air_timer_s <= 0:
            p = 0.02 if st.get("state") == PLC_STARTING else TICK_S / 7200.0
            if random.random() < p:
                air_timer_s = random.uniform(10, 40)
                log.info("Episodio de aire arrastrado (%.0f s)", air_timer_s)
        else:
            air_timer_s -= TICK_S
        air = air_timer_s > 0

        density = density_walk.tick()
        flow = MAX_FLOW_KGH * valve_est / 100.0
        if air:
            flow *= random.uniform(0.7, 1.05)          # dos fases: medición inestable
            density -= random.uniform(20, 60)
            drive_gain = clamp(45.0 + noise(35.0), 10.0, 98.0)
        else:
            drive_gain = 8.0 + noise(1.5)
        flow = max(0.0, flow + noise(4.0 if flow > 1.0 else 0.3))
        total_kg += flow * TICK_S / 3600.0

        fluid_temp = temp_walk.tick() + noise(0.05)
        tube_freq = 147.5 - (density - 1000.0) * 0.012 + noise(0.02)
        sensor_temp = fluid_temp + 0.8 + noise(0.1)
        vol_flow_lph = flow / density * 1000.0 if density > 0 else 0.0

        regs = (
            f32_to_regs(flow)            # 0-1   mass_flow_kgh
            + f32_to_regs(vol_flow_lph)  # 2-3   volume_flow_lph
            + f32_to_regs(density)       # 4-5   density_kgm3
            + f32_to_regs(fluid_temp)    # 6-7   fluid_temp_c
            + f32_to_regs(total_kg)      # 8-9   total_mass_kg
            + f32_to_regs(drive_gain)    # 10-11 drive_gain_pct
            + f32_to_regs(tube_freq)     # 12-13 tube_freq_hz
            + f32_to_regs(sensor_temp)   # 14-15 sensor_temp_c
        )
        regs.append(pack_bits(plc.ok, air, False))  # 16 status_word
        context[0x00].setValues(FC_HR, 0, regs)

        await asyncio.sleep(TICK_S)


async def main() -> None:
    plc = PlcLink()
    store = ModbusSlaveContext(
        hr=ModbusSequentialDataBlock(0, [0] * 32),
        ir=ModbusSequentialDataBlock(0, [0] * 32),
        zero_mode=True,
    )
    context = ModbusServerContext(slaves=store, single=True)

    log.info("Modbus TCP en :%d (FC3, float32 BE)", MODBUS_PORT)
    await asyncio.gather(
        plc.run(),
        update_loop(context, plc),
        StartAsyncTcpServer(context=context, address=("0.0.0.0", MODBUS_PORT)),
    )


if __name__ == "__main__":
    asyncio.run(main())
