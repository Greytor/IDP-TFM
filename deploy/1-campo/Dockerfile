FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY sims/ ./sims/

# Imagen única para los 4 simuladores: cada servicio del compose
# elige su dispositivo con `command: python -m sims.<modulo>`
CMD ["python", "-m", "sims.plc_llenado"]
