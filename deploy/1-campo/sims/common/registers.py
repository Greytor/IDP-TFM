"""Codificación de registros Modbus.

float32 big-endian con palabra alta primero — la convención de Micro Motion
y Eastron SDM, y la que ya usa el flow de Node-RED (writeUInt16BE +
readFloatBE sobre pares de registros).
"""
import struct


def f32_to_regs(value: float) -> list[int]:
    """Un float IEEE-754 → dos registros de 16 bits (hi, lo)."""
    hi, lo = struct.unpack(">HH", struct.pack(">f", float(value)))
    return [hi, lo]


def pack_bits(*bits: bool) -> int:
    """Empaqueta booleanos en una palabra de estado: bit0 = primer argumento."""
    word = 0
    for i, b in enumerate(bits):
        if b:
            word |= 1 << i
    return word
