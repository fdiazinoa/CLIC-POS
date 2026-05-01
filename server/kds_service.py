from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import sqlite3
import json
from datetime import datetime
import os
import shutil
import subprocess
import tempfile
import socket

app = FastAPI(title="CLIC-POS KDS Service")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DB Path relative to server folder
DB_PATH = os.path.join(os.path.dirname(__file__), "db.sqlite")

class StatusUpdate(BaseModel):
    item_id: Optional[str] = None
    orden_id: Optional[str] = None
    nuevo_estado: str  # 'PENDIENTE', 'EN_PREPARACION', 'LISTO'

class ProductionArea(BaseModel):
    id: str
    nombre: str
    modo_salida: str
    target_terminal_id: Optional[str] = None
    printer_ip: Optional[str] = None

class TableOpenRequest(BaseModel):
    tableId: str
    waiterId: Optional[str] = None
    waiterName: Optional[str] = None

class PrintJobRequest(BaseModel):
    html: str
    printerId: Optional[str] = None
    printerName: Optional[str] = None
    printerAddress: Optional[str] = None
    connection: Optional[str] = None
    role: Optional[str] = None
    jobType: Optional[str] = None
    referenceId: Optional[str] = None
    copies: Optional[int] = 1

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def send_text_to_network_printer(printer_ip: str, content: str, port: int = 9100, timeout: int = 3):
    payload = b"\x1b@" + content.encode("ascii", "ignore") + b"\n\n\n" + b"\x1dVA0"
    with socket.create_connection((printer_ip, port), timeout=timeout) as sock:
        sock.sendall(payload)

def normalize_direct_kds_item(item: dict, index: int) -> dict:
    quantity = item.get("quantity", item.get("cantidad", 1))
    try:
        quantity = float(quantity)
    except (TypeError, ValueError):
        quantity = 1

    modifiers = item.get("modifiers", item.get("modificadores", []))
    if modifiers is None:
        modifiers = []
    if not isinstance(modifiers, list):
        modifiers = [str(modifiers)]

    product_id = item.get("producto_id") or item.get("productId") or item.get("id") or f"item-{index}"
    name = item.get("nombre") or item.get("name") or item.get("description") or "Producto"

    return {
        "id": str(item.get("id") or item.get("cartId") or f"{product_id}-{index}"),
        "producto_id": str(product_id),
        "name": str(name),
        "quantity": quantity,
        "modifiers": modifiers,
    }

def upsert_direct_kds_order(conn, orden_id: str, payload: dict):
    items = [normalize_direct_kds_item(item, index) for index, item in enumerate(payload.get("items") or [])]
    now = payload.get("date") or datetime.now().isoformat()
    total = payload.get("total") or sum((item["quantity"] for item in items))
    display_id = payload.get("displayId") or orden_id
    user_name = payload.get("userName") or ""
    customer_name = payload.get("customerName") or "Cliente General"
    customer_id = payload.get("customerId") or ""

    try:
        conn.execute(
            """
            INSERT INTO transactions (id, displayId, status, items, total, date, userName, customerName, customerId)
            VALUES (?, ?, 'EN_COCINA', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                displayId = excluded.displayId,
                status = 'EN_COCINA',
                items = excluded.items,
                total = excluded.total,
                userName = excluded.userName,
                customerName = excluded.customerName,
                customerId = excluded.customerId
            """,
            (orden_id, display_id, json.dumps(items), total, now, user_name, customer_name, customer_id)
        )
    except sqlite3.OperationalError:
        # Older local KDS databases may not have all metadata columns yet.
        conn.execute(
            """
            INSERT INTO transactions (id, status, items, total, date)
            VALUES (?, 'EN_COCINA', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status = 'EN_COCINA',
                items = excluded.items,
                total = excluded.total
            """,
            (orden_id, json.dumps(items), total, now)
        )

    area = payload.get("area") or {}
    area_id = str(area.get("id") or "GENERAL")
    dispatched_count = 0

    for index, item in enumerate(items):
        detail_id = f"{orden_id}_{area_id}_{item['id']}_{index}"
        exists = conn.execute("SELECT 1 FROM ordenes_detalles WHERE id = ?", (detail_id,)).fetchone()
        if exists:
            continue

        conn.execute(
            "INSERT INTO ordenes_detalles (id, orden_id, producto_id, nombre, cantidad, modificadores, estado_cocina) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                detail_id,
                orden_id,
                item["producto_id"],
                item["name"],
                item["quantity"],
                json.dumps(item["modifiers"]),
                "PENDIENTE",
            )
        )
        dispatched_count += 1

    return dispatched_count

@app.post("/api/ordenes/enviar-comanda/{orden_id}")
def dispatch_command(orden_id: str, payload: Optional[dict] = None):
    conn = get_db_connection()
    try:
        if payload and payload.get("items"):
            dispatched_count = upsert_direct_kds_order(conn, orden_id, payload)
            conn.commit()
            return {"status": "success", "dispatched": dispatched_count, "mode": "direct_payload"}

        # 1. Check if kitchen module is enabled
        config = conn.execute("SELECT usa_modulos_cocina FROM parametros_operativos LIMIT 1").fetchone()
        if not config or not config['usa_modulos_cocina']:
            return {"status": "ignored", "message": "Kitchen module disabled"}

        # 2. Get the transaction and its items
        order = conn.execute("SELECT items FROM transactions WHERE id = ?", (orden_id,)).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        
        items = json.loads(order['items'])
        
        # 3. Filter items not yet sent
        new_items = []
        for i, item in enumerate(items):
            if item.get('estado_comanda') != 'ENVIADO':
                item['_index'] = i # Keep track of index to mark as sent later
                new_items.append(item)
        
        if not new_items:
            return {"status": "no_changes", "message": "All items already sent"}

        # 4. Group by production area
        # We need to fetch product info to get production_area_id
        product_ids = [it['id'] for it in new_items]
        placeholders = ','.join(['?'] * len(product_ids))
        products_info = conn.execute(f"SELECT id, production_area_id FROM products WHERE id IN ({placeholders})", product_ids).fetchall()
        product_to_area = {p['id']: p['production_area_id'] for p in products_info}

        # Fetch production area details
        areas = conn.execute("SELECT * FROM production_areas").fetchall()
        area_details = {a['id']: dict(a) for a in areas}

        # 5. Route items
        dispatched_count = 0
        for item in new_items:
            area_id = product_to_area.get(item['id'])
            if not area_id or area_id not in area_details:
                continue # No routing configured for this item
            
            area = area_details[area_id]
            mode = area['modo_salida']
            
            # KDS Routing
            if mode in ('KDS', 'AMBOS'):
                item_id = f"{orden_id}_{item['_index']}"
                # Check if already in ordenes_detalles
                exists = conn.execute("SELECT 1 FROM ordenes_detalles WHERE id = ?", (item_id,)).fetchone()
                if not exists:
                    conn.execute(
                        "INSERT INTO ordenes_detalles (id, orden_id, producto_id, nombre, cantidad, modificadores, estado_cocina) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (item_id, orden_id, item['id'], item['name'], item['quantity'], json.dumps(item.get('modifiers', [])), 'PENDIENTE')
                    )
                    dispatched_count += 1
            
            # Printer Routing
            if mode in ('PRINTER', 'AMBOS'):
                printer_ip = area.get('printer_ip')
                if printer_ip:
                    ticket = (
                        f"COMANDA {orden_id}\n"
                        f"AREA: {area.get('nombre', 'PRODUCCION')}\n"
                        f"------------------------------\n"
                        f"{item.get('quantity', 1)} x {item.get('name', 'ITEM')}\n"
                    )
                    if item.get('modifiers'):
                        modifiers = ", ".join(item.get('modifiers', []))
                        ticket += f"MOD: {modifiers}\n"
                    ticket += f"------------------------------\n{datetime.now().strftime('%d/%m/%Y %H:%M')}\n"

                    try:
                        send_text_to_network_printer(printer_ip, ticket)
                        dispatched_count += 1
                    except Exception as print_error:
                        print(f"ERROR printing kitchen item to {printer_ip}: {print_error}")
                else:
                    print(f"WARN: Production area {area.get('nombre')} has no printer_ip configured")

            # Mark as sent in the original item object
            items[item['_index']]['estado_comanda'] = 'ENVIADO'

        # 6. Update order status to EN_COCINA
        conn.execute("UPDATE transactions SET status = 'EN_COCINA', items = ? WHERE id = ?", (json.dumps(items), orden_id))
        
        # 7. Ensure table is marked as OCCUPIED
        conn.execute("UPDATE tables SET status = 'OCCUPIED' WHERE currentOrderId = ?", (orden_id,))

        conn.commit()
        return {"status": "success", "dispatched": dispatched_count}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.put("/api/ordenes/{orden_id}")
def update_order(orden_id: str, data: dict):
    conn = get_db_connection()
    try:
        items = data.get('items', [])
        total = data.get('total', 0)
        
        # Check if transaction exists
        cursor = conn.execute("SELECT 1 FROM transactions WHERE id = ?", (orden_id,))
        exists = cursor.fetchone()

        if exists:
            conn.execute(
                "UPDATE transactions SET items = ?, total = ? WHERE id = ?",
                (json.dumps(items), total, orden_id)
            )
        else:
            # Create new if not exists (UPSERT behavior)
            now = datetime.now().isoformat()
            conn.execute(
                "INSERT INTO transactions (id, status, items, total, date) VALUES (?, 'ABIERTA', ?, ?, ?)",
                (orden_id, json.dumps(items), total, now)
            )
        
        # Ensure table is linked and status is updated (Ghost table logic in GET /api/mesas depends on items > 0)
        # But we also want to explicitly update tables table for redundancy/consistency during transition
        if items:
            conn.execute("UPDATE tables SET status = 'OCCUPIED' WHERE currentOrderId = ?", (orden_id,))
        
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.get("/api/mesas")
def get_tables():
    conn = get_db_connection()
    try:
        # Ghost Table Logic:
        # A table is OCCUPIED if it has a currentOrderId AND that order has items.
        # Otherwise it is FREE.
        tables = conn.execute("SELECT * FROM tables").fetchall()
        result = []
        for t in tables:
            table_dict = dict(t)
            # If no order, it's definitely FREE
            if not table_dict['currentOrderId']:
                table_dict['status'] = 'FREE'
            else:
                # Check if the order has items
                order = conn.execute("SELECT items FROM transactions WHERE id = ?", (table_dict['currentOrderId'],)).fetchone()
                if order:
                    items = json.loads(order['items']) if order['items'] else []
                    if len(items) > 0:
                        table_dict['status'] = 'OCCUPIED'
                    else:
                        table_dict['status'] = 'FREE'
                else:
                    table_dict['status'] = 'FREE'
            result.append(table_dict)
        return result
    finally:
        conn.close()

@app.post("/api/mesas/abrir")
def open_table(req: TableOpenRequest):
    conn = get_db_connection()
    try:
        # Check if already has an open order
        table = conn.execute("SELECT currentOrderId FROM tables WHERE id = ?", (req.tableId,)).fetchone()
        if table and table['currentOrderId']:
            return {"status": "success", "orden_id": table['currentOrderId']}
        
        # Create new order (ABIERTA)
        orden_id = f"ORD-{int(datetime.now().timestamp())}"
        now = datetime.now().isoformat()
        
        # Insert into transactions (minimal for opening)
        conn.execute("""
            INSERT INTO transactions (id, status, date, items, total, userId, userName) 
            VALUES (?, 'ABIERTA', ?, '[]', 0, ?, ?)
        """, (orden_id, now, req.waiterId, req.waiterName))
        
        # Link table
        conn.execute("""
            UPDATE tables 
            SET currentOrderId = ?, 
                status = 'OCCUPIED', 
                waiterName = ?,
                timeSeated = ?
            WHERE id = ?
        """, (orden_id, req.waiterName, now, req.tableId))
        
        conn.commit()
        return {"status": "success", "orden_id": orden_id}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.get("/api/produccion/areas")
def get_production_areas():
    conn = get_db_connection()
    try:
        areas = conn.execute("SELECT * FROM production_areas").fetchall()
        return [dict(a) for a in areas]
    finally:
        conn.close()

@app.post("/api/produccion/areas")
def save_production_area(area: ProductionArea):
    conn = get_db_connection()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO production_areas (id, nombre, modo_salida, target_terminal_id, printer_ip) VALUES (?, ?, ?, ?, ?)",
            (area.id, area.nombre, area.modo_salida, area.target_terminal_id, area.printer_ip)
        )
        conn.commit()
        return {"status": "success"}
    finally:
        conn.close()

@app.get("/api/cocina/ordenes-activas")
def get_active_orders():
    conn = get_db_connection()
    try:
        # Get orders that are OPEN or in kitchen
        # We also need to join with ordenes_detalles to get items
        # FIFO: Order by date ascending
        query = """
        SELECT t.id, t.displayId, t.date, t.userName, t.customerId, t.customerName
        FROM transactions t
        WHERE t.status IN ('ABIERTA', 'EN_COCINA')
        ORDER BY t.date ASC
        """
        orders = conn.execute(query).fetchall()
        
        result = []
        for order in orders:
            order_dict = dict(order)
            
            # Get details for this order
            items_query = """
            SELECT id, producto_id, nombre, cantidad, modificadores, estado_cocina, hora_inicio_preparacion
            FROM ordenes_detalles
            WHERE orden_id = ?
            """
            items = conn.execute(items_query, (order['id'],)).fetchall()
            
            order_dict['items'] = []
            for item in items:
                item_dict = dict(item)
                if item_dict['modificadores']:
                    item_dict['modificadores'] = json.loads(item_dict['modificadores'])
                order_dict['items'].append(item_dict)
            
            # Only include order if it has items pending or in prep
            if any(i['estado_cocina'] in ('PENDIENTE', 'EN_PREPARACION') for i in order_dict['items']):
                result.append(order_dict)
                
        return result
    finally:
        conn.close()

@app.post("/api/cocina/cambiar-estado")
def update_status(update: StatusUpdate):
    conn = get_db_connection()
    try:
        now = datetime.now().isoformat()
        
        if update.item_id:
            # Update specific item
            extra_sql = ""
            params = [update.nuevo_estado, update.item_id]
            
            if update.nuevo_estado == 'EN_PREPARACION':
                extra_sql = ", hora_inicio_preparacion = ?"
                params.insert(1, now)
            elif update.nuevo_estado == 'LISTO':
                extra_sql = ", hora_terminado = ?"
                params.insert(1, now)
                
            conn.execute(f"UPDATE ordenes_detalles SET estado_cocina = ? {extra_sql} WHERE id = ?", params)
            
            # Check if all items in the same order are now 'LISTO'
            item_info = conn.execute("SELECT orden_id FROM ordenes_detalles WHERE id = ?", (update.item_id,)).fetchone()
            if item_info:
                check_all_ready(conn, item_info['orden_id'])
                
        elif update.orden_id:
            # Update entire order
            conn.execute("UPDATE ordenes_detalles SET estado_cocina = ? WHERE orden_id = ?", (update.nuevo_estado, update.orden_id))
            if update.nuevo_estado == 'LISTO':
                conn.execute("UPDATE transactions SET status = 'PARA_ENTREGAR' WHERE id = ?", (update.orden_id,))
                
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.get("/api/config/operativa")
def get_operational_config():
    conn = get_db_connection()
    try:
        config = conn.execute("SELECT usa_modulos_cocina FROM parametros_operativos LIMIT 1").fetchone()
        return dict(config) if config else {"usa_modulos_cocina": False}
    finally:
        conn.close()

@app.post("/api/config/operativa")
def update_operational_config(config: dict):
    conn = get_db_connection()
    try:
        conn.execute("UPDATE parametros_operativos SET usa_modulos_cocina = ?", (config.get('usa_modulos_cocina', False),))
        conn.commit()
        return {"status": "success"}
    finally:
        conn.close()

def check_all_ready(conn, orden_id):
    # Check if any item is still not ready
    pending = conn.execute(
        "SELECT COUNT(*) as count FROM ordenes_detalles WHERE orden_id = ? AND estado_cocina != 'LISTO'", 
        (orden_id,)
    ).fetchone()
    
    if pending['count'] == 0:
        conn.execute("UPDATE transactions SET status = 'PARA_ENTREGAR' WHERE id = ?", (orden_id,))

def spool_to_local_printer(file_path: str, printer_name: Optional[str], copies: int = 1) -> str:
    safe_copies = max(1, int(copies or 1))

    if shutil.which("lp"):
        command = ["lp", "-n", str(safe_copies)]
        if printer_name:
            command.extend(["-d", printer_name])
        command.append(file_path)
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "lp failed")
        return result.stdout.strip() or "Printed with lp"

    if shutil.which("lpr"):
        for _ in range(safe_copies):
            command = ["lpr"]
            if printer_name:
                command.extend(["-P", printer_name])
            command.append(file_path)
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "lpr failed")
        return "Printed with lpr"

    raise RuntimeError("No local print command found (lp/lpr)")

@app.post("/api/print/jobs")
def print_job(job: PrintJobRequest):
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".html", mode="w", encoding="utf-8") as temp_file:
            temp_file.write(job.html)
            temp_path = temp_file.name

        message = spool_to_local_printer(temp_path, job.printerName, job.copies or 1)

        return {
            "status": "success",
            "message": message,
            "printer": job.printerName or job.printerId or "default",
            "jobType": job.jobType or "GENERIC"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Print error: {str(e)}")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
