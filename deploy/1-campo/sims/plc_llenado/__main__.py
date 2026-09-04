"""PLC maestro de la celda de llenado.

- OPC UA (:4840): variables de línea bajo Objects/Llenadora (ns=2;s=Llenadora.*)
  y nodos de comando escribibles bajo Objects/Cmd — preparados para el flujo
  cmd del UNS en un sprint posterior (contrato §7.4.1).
- REST (:8080): GET /state es el canal interno de causalidad que consultan
  los otros simuladores; GET /healthz para el healthcheck del compose.
"""
import asyncio
import logging
import os

from aiohttp import web
from asyncua import Server, ua

from .model import RUNNING, STATE_TEXT, FillingLine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("asyncua").setLevel(logging.WARNING)
log = logging.getLogger("plc-llenado")

OPCUA_PORT = int(os.environ.get("OPCUA_PORT", "4840"))
REST_PORT = int(os.environ.get("REST_PORT", "8080"))
TICK_S = 0.5


def state_dict(line: FillingLine) -> dict:
    return {
        "state": line.state,
        "state_text": STATE_TEXT[line.state],
        "running": line.state == RUNNING,
        "target_flow_kgh": round(line.target_flow_kgh, 2),
        "valve_cmd_pct": round(line.valve_cmd_pct, 2),
        "speed_bpm": round(line.speed_bpm, 2),
        "good_count": line.good_count,
        "bad_count": line.bad_count,
        "alarm_jam": line.alarm_jam,
        "auto_mode": line.auto_mode,
        "uptime_s": int(line.uptime_s),
    }


async def main() -> None:
    line = FillingLine()

    # ── OPC UA ────────────────────────────────────────────────────────────────
    server = Server()
    await server.init()
    server.set_endpoint(f"opc.tcp://0.0.0.0:{OPCUA_PORT}/greytec/plc-llenado/")
    server.set_server_name("Greytec Sim - PLC Llenado")
    server.set_security_policy([ua.SecurityPolicyType.NoSecurity])
    idx = await server.register_namespace("urn:greytec:sim:plc-llenado")

    def nid(s: str) -> ua.NodeId:
        return ua.NodeId(s, idx)

    def qn(s: str) -> ua.QualifiedName:
        return ua.QualifiedName(s, idx)

    VT = ua.VariantType
    obj = await server.nodes.objects.add_object(nid("Llenadora"), qn("Llenadora"))
    v_state = await obj.add_variable(nid("Llenadora.State"), qn("State"), 0, varianttype=VT.Int32)
    v_text = await obj.add_variable(nid("Llenadora.StateText"), qn("StateText"), "STOPPED", varianttype=VT.String)
    v_good = await obj.add_variable(nid("Llenadora.GoodCount"), qn("GoodCount"), 0, varianttype=VT.UInt32)
    v_bad = await obj.add_variable(nid("Llenadora.BadCount"), qn("BadCount"), 0, varianttype=VT.UInt32)
    v_speed = await obj.add_variable(nid("Llenadora.SpeedBpm"), qn("SpeedBpm"), 0.0, varianttype=VT.Float)
    v_flow = await obj.add_variable(nid("Llenadora.TargetFlowKgh"), qn("TargetFlowKgh"), 0.0, varianttype=VT.Float)
    v_valve = await obj.add_variable(nid("Llenadora.ValveCmdPct"), qn("ValveCmdPct"), 0.0, varianttype=VT.Float)
    v_jam = await obj.add_variable(nid("Llenadora.AlarmJam"), qn("AlarmJam"), False, varianttype=VT.Boolean)
    v_up = await obj.add_variable(nid("Llenadora.UptimeS"), qn("UptimeS"), 0, varianttype=VT.UInt32)

    # Nodos de comando: escribibles desde ya, se honran con AutoMode=False.
    # El flujo cmd del UNS (Node-RED → OPC UA write) se conecta aquí después.
    cmd = await server.nodes.objects.add_object(nid("Cmd"), qn("Cmd"))
    c_auto = await cmd.add_variable(nid("Cmd.AutoMode"), qn("AutoMode"), True, varianttype=VT.Boolean)
    c_start = await cmd.add_variable(nid("Cmd.Start"), qn("Start"), False, varianttype=VT.Boolean)
    c_stop = await cmd.add_variable(nid("Cmd.Stop"), qn("Stop"), False, varianttype=VT.Boolean)
    c_flow = await cmd.add_variable(nid("Cmd.TargetFlowKgh"), qn("TargetFlowKgh"), 0.0, varianttype=VT.Float)
    for node in (c_auto, c_start, c_stop, c_flow):
        await node.set_writable()

    # ── REST /state ───────────────────────────────────────────────────────────
    async def get_state(_request: web.Request) -> web.Response:
        return web.json_response(state_dict(line))

    async def healthz(_request: web.Request) -> web.Response:
        return web.Response(text="ok")

    app = web.Application()
    app.router.add_get("/state", get_state)
    app.router.add_get("/healthz", healthz)
    # sin access log: los 3 esclavos hacen poll cada 0.5 s y ahogarían
    # las transiciones de estado en `docker logs`
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", REST_PORT).start()

    log.info("OPC UA en :%d (ns=%d) — REST /state en :%d", OPCUA_PORT, idx, REST_PORT)

    # ── lazo del modelo ───────────────────────────────────────────────────────
    last_state = line.state
    async with server:
        while True:
            line.auto_mode = bool(await c_auto.read_value())
            manual = None
            if not line.auto_mode:
                manual = {
                    "start": bool(await c_start.read_value()),
                    "stop": bool(await c_stop.read_value()),
                    "target_flow_kgh": float(await c_flow.read_value()),
                }
            line.tick(TICK_S, manual)
            if manual and (manual["start"] or manual["stop"]):
                # Start/Stop son pulsos: se consumen al aplicarse
                await c_start.write_value(False)
                await c_stop.write_value(False)

            if line.state != last_state:
                log.info("linea %s -> %s (good=%d bad=%d)",
                         STATE_TEXT[last_state], STATE_TEXT[line.state],
                         line.good_count, line.bad_count)
                last_state = line.state

            await v_state.write_value(ua.Variant(line.state, VT.Int32))
            await v_text.write_value(STATE_TEXT[line.state])
            await v_good.write_value(ua.Variant(line.good_count, VT.UInt32))
            await v_bad.write_value(ua.Variant(line.bad_count, VT.UInt32))
            await v_speed.write_value(ua.Variant(round(line.speed_bpm, 2), VT.Float))
            await v_flow.write_value(ua.Variant(round(line.target_flow_kgh, 2), VT.Float))
            await v_valve.write_value(ua.Variant(round(line.valve_cmd_pct, 2), VT.Float))
            await v_jam.write_value(line.alarm_jam)
            await v_up.write_value(ua.Variant(int(line.uptime_s), VT.UInt32))

            await asyncio.sleep(TICK_S)


if __name__ == "__main__":
    asyncio.run(main())
