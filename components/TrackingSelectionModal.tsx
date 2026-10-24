import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Calendar,
  ScanBarcode,
  Check,
  AlertCircle,
  Search,
} from "lucide-react";
import { Product, InventoryTracking, Warehouse } from "../types";
import { db } from "../utils/db";
import Decimal from "decimal.js";

interface TrackingSelectionModalProps {
  product: Product;
  warehouseId: string;
  quantity: number;
  onSelect: (tracking: InventoryTracking[]) => void;
  onClose: () => void;
  loadOptions?: () => Promise<InventoryTracking[]>;
}

const TrackingSelectionModal: React.FC<TrackingSelectionModalProps> = ({
  product,
  warehouseId,
  quantity,
  onSelect,
  onClose,
  loadOptions,
}) => {
  const [availableTracking, setAvailableTracking] = useState<
    InventoryTracking[]
  >([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [lotQuantities, setLotQuantities] = useState<Record<string, string>>(
    {},
  );
  const minor = (value: string | number): number => {
    try {
      const scaled = new Decimal(value).mul(1000000);
      return scaled.isInteger() &&
        scaled.gte(0) &&
        scaled.lte(Number.MAX_SAFE_INTEGER)
        ? scaled.toNumber()
        : -1;
    } catch {
      return -1;
    }
  };
  const requestedMinor = minor(quantity);
  const selectedMinor = isFinite(quantity)
    ? Object.values(lotQuantities).reduce((sum, value) => {
        const amount = minor(value);
        return amount < 0 || sum < 0 ? -1 : sum + amount;
      }, 0)
    : -1;
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const isLot = product.operationalFlags?.usesLots;
  const isSerial = product.operationalFlags?.usesSerial;

  useEffect(() => {
    let current = true;
    setLoadError("");
    setSelectedIds(new Set());
    setLotQuantities({});
    const loadTracking = async () => {
      setIsLoading(true);
      try {
        const allTracking = loadOptions
          ? await loadOptions()
          : ((await db.get("inventoryTracking")) as InventoryTracking[]) || [];
        const filtered = allTracking.filter(
          (t) =>
            t.productId === product.id &&
            t.warehouseId === warehouseId &&
            t.status === "AVAILABLE",
        );

        // FEFO Logic for Lots: Sort by Expiration Date
        if (isLot && !isSerial) {
          filtered.sort((a, b) => {
            if (!a.expirationDate) return 1;
            if (!b.expirationDate) return -1;
            return (
              new Date(a.expirationDate).getTime() -
              new Date(b.expirationDate).getTime()
            );
          });
        }

        if (current) setAvailableTracking(filtered);
      } catch (error) {
        if (current) {
          setAvailableTracking([]);
          setLoadError(
            error instanceof Error
              ? error.message
              : "No se pudo cargar trazabilidad.",
          );
        }
      } finally {
        if (current) setIsLoading(false);
      }
    };
    loadTracking();
    return () => {
      current = false;
    };
  }, [product.id, warehouseId, isLot, isSerial, loadOptions]);

  const filteredItems = useMemo(() => {
    if (!searchTerm) return availableTracking;
    return availableTracking.filter((t) =>
      t.trackingCode.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [availableTracking, searchTerm]);

  const handleConfirm = () => {
    const selected = availableTracking.filter((t) => selectedIds.has(t.id));
    if (loadOptions && isLot && !isSerial) {
      if (
        requestedMinor <= 0 ||
        selectedMinor !== requestedMinor ||
        selected.some(
          (t) =>
            !t.v3Authority ||
            minor(lotQuantities[t.id] || "0") <= 0 ||
            minor(lotQuantities[t.id] || "0") > Number(t.availableMinor),
        )
      ) {
        setLoadError(
          "Distribuye la cantidad exacta entre los lotes sin superar su existencia asignada.",
        );
        return;
      }
      onSelect(
        selected.map((t) => ({
          ...t,
          selectedQuantityMinor: minor(lotQuantities[t.id]),
        })),
      );
      return;
    }
    if (isSerial && selected.length !== quantity) {
      alert(`Debe seleccionar exactamente ${quantity} números de serie.`);
      return;
    }
    if (isLot && selected.length === 0) {
      alert("Debe seleccionar al menos un lote.");
      return;
    }
    if (loadOptions) {
      if (
        selected.some(
          (t) =>
            !t.v3Authority ||
            Number(t.availableMinor) <
              (isSerial ? 1000000 : quantity * 1000000),
        )
      ) {
        setLoadError("La existencia asignada no alcanza para esta cantidad.");
        return;
      }
      onSelect(
        selected.map((t) => ({
          ...t,
          selectedQuantityMinor: isSerial ? 1000000 : quantity * 1000000,
        })),
      );
      return;
    }
    onSelect(selected);
  };

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (isLot && !isSerial) {
      if (loadOptions) {
        if (next.has(id)) {
          next.delete(id);
          setLotQuantities((previous) => {
            const copy = { ...previous };
            delete copy[id];
            return copy;
          });
        } else {
          next.add(id);
          const option = availableTracking.find((item) => item.id === id);
          const amount = Math.max(
            0,
            Math.min(
              Number(option?.availableMinor || 0),
              requestedMinor - Math.max(0, selectedMinor),
            ),
          );
          setLotQuantities((previous) => ({
            ...previous,
            [id]: new Decimal(amount).div(1000000).toString(),
          }));
        }
      } else {
        next.clear();
        next.add(id);
      }
    } else {
      if (next.has(id)) next.delete(id);
      else if (next.size < quantity) next.add(id);
    }
    setSelectedIds(next);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      {loadError && (
        <div
          role="alert"
          className="absolute top-4 rounded bg-white p-4 text-red-700"
        >
          {loadError}
        </div>
      )}
      <div className="bg-white rounded-[2.5rem] w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-8 border-b bg-gray-50/50 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div
              className={`p-4 rounded-2xl ${isLot ? "bg-orange-100 text-orange-600" : "bg-blue-100 text-blue-600"}`}
            >
              {isLot ? <Calendar size={32} /> : <ScanBarcode size={32} />}
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-800 tracking-tight">
                Seleccionar {isLot ? "Lote" : "Serie"}
              </h2>
              <p className="text-sm font-bold text-gray-400">
                {product.name} (Cant: {quantity})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-3 hover:bg-gray-100 rounded-2xl text-gray-400 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Search */}
        <div className="p-6 border-b">
          <div className="relative">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
              size={20}
            />
            <input
              type="text"
              placeholder={`Buscar ${isLot ? "lote" : "serie"}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-gray-100 border-none rounded-2xl text-base font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>

        {loadOptions && isLot && !isSerial && (
          <p className="px-6 pt-3 text-sm text-gray-600">
            Distribuye la cantidad entre los lotes. Se muestran primero los
            vencimientos más próximos.
          </p>
        )}
        {/* List */}
        <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
          {isLoading ? (
            <div className="h-40 flex flex-col items-center justify-center space-y-3 opacity-30">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="font-bold text-xs uppercase tracking-widest">
                Cargando Disponibilidad...
              </p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="h-60 flex flex-col items-center justify-center text-center p-8 opacity-40">
              <AlertCircle size={48} className="mb-4 text-orange-500" />
              <p className="font-black text-gray-800 mb-1">
                Sin Stock Trazable
              </p>
              <p className="text-sm font-medium text-gray-500">
                No hay {isLot ? "lotes" : "series"} disponibles en este almacén
                para este producto.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredItems.map((item) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => toggleSelection(item.id)}
                    className={`p-5 rounded-[1.5rem] border-2 cursor-pointer transition-all flex items-center justify-between group ${
                      isSelected
                        ? "bg-blue-50 border-blue-500 shadow-sm"
                        : "bg-white border-gray-100 hover:border-gray-200"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          isSelected
                            ? "bg-blue-600 border-blue-600"
                            : "border-gray-300"
                        }`}
                      >
                        {isSelected && (
                          <Check size={14} className="text-white" />
                        )}
                      </div>
                      <div>
                        <p
                          className={`font-black tracking-tight ${isSelected ? "text-blue-900" : "text-gray-800"}`}
                        >
                          {item.trackingCode}
                        </p>
                        {item.expirationDate && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Calendar size={12} className="text-gray-400" />
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                              Vence:{" "}
                              {new Date(
                                item.expirationDate,
                              ).toLocaleDateString()}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                    {loadOptions && isLot && !isSerial && isSelected && (
                      <label
                        onClick={(event) => event.stopPropagation()}
                        className="text-xs font-bold text-gray-600"
                      >
                        Cantidad (disponible{" "}
                        {new Decimal(item.availableMinor || 0)
                          .div(1000000)
                          .toString()}
                        )
                        <input
                          aria-label={`Cantidad del lote ${item.trackingCode}`}
                          type="text"
                          inputMode="decimal"
                          value={lotQuantities[item.id] || ""}
                          onChange={(event) =>
                            setLotQuantities((previous) => ({
                              ...previous,
                              [item.id]: event.target.value,
                            }))
                          }
                          className="block w-28 rounded border p-2"
                        />
                      </label>
                    )}
                    {isLot && isSelected && !loadOptions && (
                      <span className="bg-blue-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-lg shadow-blue-500/30">
                        Seleccionado
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-8 bg-gray-50 border-t border-gray-100">
          <div className="flex items-center justify-between mb-6 px-2">
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                Selección Actual
              </p>
              <p className="text-lg font-black text-gray-800">
                {loadOptions && isLot && !isSerial
                  ? `${selectedMinor < 0 ? "Cantidad inválida" : new Decimal(selectedMinor).div(1000000).toString()} de ${quantity}`
                  : `${selectedIds.size} de ${quantity}`}{" "}
                asignados
              </p>
            </div>
            {isSerial && selectedIds.size < quantity && (
              <div className="flex items-center gap-2 text-orange-600 bg-orange-50 px-3 py-1.5 rounded-xl border border-orange-100">
                <AlertCircle size={14} />
                <span className="text-[10px] font-black uppercase">
                  Faltan {quantity - selectedIds.size}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={handleConfirm}
            disabled={
              selectedIds.size === 0 ||
              (isSerial && selectedIds.size !== quantity) ||
              Boolean(
                loadOptions &&
                  isLot &&
                  !isSerial &&
                  (selectedMinor !== requestedMinor || requestedMinor <= 0),
              )
            }
            className="w-full py-5 bg-blue-600 active:bg-blue-700 text-white rounded-[1.5rem] font-black text-lg shadow-xl shadow-blue-500/20 disabled:opacity-50 disabled:shadow-none transition-all scale-100 hover:scale-[1.02]"
          >
            Confirmar Selección
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrackingSelectionModal;
