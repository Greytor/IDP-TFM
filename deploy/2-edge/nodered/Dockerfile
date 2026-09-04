FROM nodered/node-red:latest

# Nodos del stack edge (ADR-013):
#   - node-red-contrib-modbus : cliente Modbus TCP (OpenPLC, medidores)
#   - node-red-contrib-opcua  : cliente OPC UA (OpenPLC, NeuronEX)
#   - node-red-dashboard      : visualizador local del operador de campo (/ui)
#
# Son paquetes JS puros (node-opcua incluido) => construyen igual en x86 (Brix)
# y ARM (IOT2050) sin toolchain nativo.
RUN npm install --unsafe-perm --no-update-notifier --no-fund \
      node-red-contrib-modbus \
      node-red-contrib-opcua \
      node-red-dashboard
