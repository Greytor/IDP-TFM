# Imagen base mínima de Python — mismo criterio que el consumer redpanda-to-tsdb.
FROM python:3.12-slim

WORKDIR /code

# Instala dependencias primero (capa cacheada: no se reinstala si solo cambia el código).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia el paquete de la aplicación.
COPY app ./app

# uvicorn = servidor ASGI que mantiene FastAPI escuchando en el puerto 8000.
# "app.main:app" = en el paquete app, módulo main, la variable llamada app.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
