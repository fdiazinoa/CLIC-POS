#!/bin/bash

# start_kds.sh
# Inicia el servicio de cocina (KDS) para CLIC-POS

echo "🚀 Iniciando Servicio de Cocina (KDS) en puerto 8001..."

# Verificar si el puerto ya está en uso
if lsof -i :8001 > /dev/null; then
    echo "⚠️ El puerto 8001 ya está en uso. Intentando reiniciar..."
    lsof -ti :8001 | xargs kill -9
fi

# Iniciar el servicio
python3 server/kds_service.py
