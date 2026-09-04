"""Válvula de control con posicionador inteligente (OPC UA :4841).

Sigue el mando del PLC maestro (valve_cmd_pct vía GET /state) con dinámica
de actuador: lag de primer orden (τ ≈ 2 s), banda muerta de fricción, y
salud del posicionador — recorrido total del vástago, ciclos de inversión
y alarma de desviación sostenida (posición vs setpoint). Sin enlace al PLC
degrada a setpoint 0 y publica PlcLinkOk=False (→ q=uncertain en el UNS).

Nodos: ns=2;s=Valvula.* — ver README.md.
"""
import asyncio
import logging
import os

from asyncua import Server, ua

from ..common.model_utils import RandomWalk, clamp, lag, noise
from ..common.plc_link import PlcLink

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("asyncua").setLevel(logging.WARNING)
log = logging.getLogger("valvula")

OPCUA_PORT = int(os.environ.get("OPCUA_PORT", "4841"))
TICK_S = 0.5
TAU_S = 2.0          # constante de tiempo del actuador
STROKE_M = 0.05      # carrera total del vástago (100% de apertura)
FRICTION_PCT = 0.3   # banda muerta de fricción: no se mueve por menos que esto
DEV_ALARM_PCT = 5.0  # desviación |pos - sp| que dispara alarma...
DEV_ALARM_S = 10.0   # ...si se sostiene este tiempo


async def main() -> None:
    plc = PlcLink()

    server = Server()
    await server.init()
    server.set_endpoint(f"opc.tcp://0.0.0.0:{OPCUA_PORT}/greytec/valvula/")
    server.set_server_name("Greytec Sim - Valvula Control")
    server.set_security_policy([ua.SecurityPolicyType.NoSecurity])
    idx = await server.register_namespace("urn:greytec:sim:valvula")

    def nid(s: str) -> ua.NodeId:
        return ua.NodeId(s, idx)

    def qn(s: str) -> ua.QualifiedName:
        return ua.QualifiedName(s, idx)

    VT = ua.VariantType
    obj = await server.nodes.objects.add_object(nid("Valvula"), qn("Valvula"))
    v_sp = await obj.add_variable(nid("Valvula.SetpointPct"), qn("SetpointPct"), 0.0, varianttype=VT.Float)
    v_pos = await obj.add_variable(nid("Valvula.PositionPct"), qn("PositionPct"), 0.0, varianttype=VT.Float)
    v_travel = await obj.add_variable(nid("Valvula.TravelTotalM"), qn("TravelTotalM"), 0.0, varianttype=VT.Float)
    v_cycles = await obj.add_variable(nid("Valvula.CycleCount"), qn("CycleCount"), 0, varianttype=VT.UInt32)
    v_air = await obj.add_variable(nid("Valvula.AirSupplyBar"), qn("AirSupplyBar"), 6.0, varianttype=VT.Float)
    v_dev = await obj.add_variable(nid("Valvula.AlarmDeviation"), qn("AlarmDeviation"), False, varianttype=VT.Boolean)
    v_link = await obj.add_variable(nid("Valvula.PlcLinkOk"), qn("PlcLinkOk"), False, varianttype=VT.Boolean)

    link_task = asyncio.create_task(plc.run())
    log.info("OPC UA en :%d (ns=%d)", OPCUA_PORT, idx)

    pos = 0.0
    travel_m = 0.0
    cycles = 0
    last_dir = 0
    dev_timer = 0.0
    air_supply = RandomWalk(6.0, 5.6, 6.4, 0.01)

    async with server:
        while True:
            sp = float(plc.state.get("valve_cmd_pct", 0.0)) if plc.ok else 0.0

            new_pos = pos
            if abs(sp - pos) > FRICTION_PCT:
                new_pos = clamp(lag(pos, sp, TAU_S, TICK_S) + noise(0.05), 0.0, 100.0)

            delta = new_pos - pos
            if abs(delta) > 0.02:
                travel_m += abs(delta) / 100.0 * STROKE_M
                direction = 1 if delta > 0 else -1
                if last_dir != 0 and direction != last_dir:
                    cycles += 1
                last_dir = direction
            pos = new_pos

            if abs(pos - sp) > DEV_ALARM_PCT:
                dev_timer += TICK_S
            else:
                dev_timer = 0.0

            await v_sp.write_value(ua.Variant(round(sp, 2), VT.Float))
            await v_pos.write_value(ua.Variant(round(pos, 2), VT.Float))
            await v_travel.write_value(ua.Variant(round(travel_m, 4), VT.Float))
            await v_cycles.write_value(ua.Variant(cycles, VT.UInt32))
            await v_air.write_value(ua.Variant(round(air_supply.tick() + noise(0.03), 3), VT.Float))
            await v_dev.write_value(dev_timer >= DEV_ALARM_S)
            await v_link.write_value(plc.ok)

            await asyncio.sleep(TICK_S)

    await link_task


if __name__ == "__main__":
    asyncio.run(main())
