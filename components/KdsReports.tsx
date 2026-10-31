import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveKdsReportsBaseUrl as resolveKdsDeviceBaseUrl, resolveKdsReportsBaseUrlForAreas } from '../utils/kdsReportsEndpoint';
import { db } from '../utils/db';
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ChefHat,
  Clock,
  Loader2,
  RefreshCw,
  Timer,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';

/**
 * Informes de KDS: órdenes por estado, tiempos de preparación, retrasos por SLA,
 * desempeño por estación y volumen por hora.
 *
 * Todo sale de los endpoints de solo lectura del servicio KDS
 * (`/api/cocina/informes/*`). No hay datos simulados: si el servicio no responde,
 * la pantalla lo dice y ofrece reintentar.
 */

const KDS_REPORTS_TIMEOUT_MS = 9000;
const SLA_POR_DEFECTO = 15;

type RangoId = 'HOY' | 'AYER' | 'SIETE_DIAS' | 'PERSONALIZADO';

interface EstadoConteo {
  estado: string;
  items: number;
  pedidos: number;
}

interface EstacionConteo {
  estacion: string;
  nombre: string;
  total_items: number;
  total_pedidos: number;
  por_estado: EstadoConteo[];
}

interface OrdersByState {
  desde: string | null;
  hasta: string | null;
  estacion: string | null;
  total_pedidos: number;
  total_items: number;
  por_estado: EstadoConteo[];
  por_estacion: EstacionConteo[];
}

interface BloqueTiempos {
  conteo: number;
  promedio_min: number | null;
  mediana_min: number | null;
  p90_min: number | null;
  maximo_min: number | null;
}

interface EstacionTiempos {
  estacion: string;
  nombre: string;
  preparacion: BloqueTiempos;
  ciclo_total: BloqueTiempos;
}

interface PrepTimes {
  desde: string | null;
  hasta: string | null;
  global: { estacion: string; nombre: string; preparacion: BloqueTiempos; ciclo_total: BloqueTiempos };
  por_estacion: EstacionTiempos[];
}

interface EstacionRetrasos {
  estacion: string;
  nombre: string;
  sla_minutes: number;
  items_medidos: number;
  items_retrasados: number;
  porcentaje_retraso: number | null;
  pedidos_medidos: number;
  pedidos_retrasados: number;
  espera_media_min: number | null;
  espera_maxima_min: number | null;
}

interface Retraso {
  detalle_id: string;
  orden_id: string;
  estacion: string;
  nombre: string;
  estado_cocina: string;
  recibido_at: string | null;
  listo_at: string | null;
  espera_min: number | null;
  sla_minutes: number;
}

interface Delays {
  sla_minutes: number;
  items_medidos: number;
  items_retrasados: number;
  porcentaje_retraso: number | null;
  pedidos_medidos: number;
  pedidos_retrasados: number;
  por_estacion: EstacionRetrasos[];
  mas_tardios: Retraso[];
}

interface EstacionDesempeno {
  estacion: string;
  nombre: string;
  atendidos: number;
  tiempo_medio_min: number | null;
  mediana_min: number | null;
  p90_min: number | null;
  maximo_min: number | null;
  sla_minutes: number;
  retrasados: number;
  porcentaje_retraso: number | null;
}

interface StationPerformance {
  sla_minutes: number;
  estaciones: EstacionDesempeno[];
}

interface HoraVolumen {
  hora: number;
  pedidos: number;
}

interface HourlyVolume {
  total_pedidos: number;
  hora_pico: number | null;
  por_hora: HoraVolumen[];
  por_estacion: Array<{ estacion: string; nombre: string; total_pedidos: number; horas: HoraVolumen[] }>;
}

interface InformeKds {
  estados: OrdersByState;
  tiempos: PrepTimes;
  retrasos: Delays;
  desempeno: StationPerformance;
  volumen: HourlyVolume;
}

/**
 * Base del servicio KDS: el mismo host y puerto que resuelve la pantalla de cocina
 * (el puerto puede venir del emparejamiento o de la preferencia del equipo).
 */
export const resolveKdsReportsBaseUrl = (override?: string): string =>
  resolveKdsDeviceBaseUrl({ override });

const dosDigitos = (valor: number) => String(valor).padStart(2, '0');

const fechaLocal = (fecha: Date): string =>
  `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}`;

/** Rango ISO (desde 00:00, hasta 23:59:59) para los presets y el modo manual. */
export const buildKdsReportsRange = (
  rango: RangoId,
  personalizado: { desde: string; hasta: string },
  hoy = new Date()
): { desde: string; hasta: string } => {
  const conHora = (fecha: string, fin: boolean) =>
    `${fecha}T${fin ? '23:59:59' : '00:00:00'}`;

  if (rango === 'PERSONALIZADO') {
    const desde = personalizado.desde || fechaLocal(hoy);
    const hasta = personalizado.hasta || fechaLocal(hoy);
    return { desde: conHora(desde, false), hasta: conHora(hasta, true) };
  }

  if (rango === 'AYER') {
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);
    return { desde: conHora(fechaLocal(ayer), false), hasta: conHora(fechaLocal(ayer), true) };
  }

  if (rango === 'SIETE_DIAS') {
    const inicio = new Date(hoy);
    inicio.setDate(inicio.getDate() - 6);
    return { desde: conHora(fechaLocal(inicio), false), hasta: conHora(fechaLocal(hoy), true) };
  }

  return { desde: conHora(fechaLocal(hoy), false), hasta: conHora(fechaLocal(hoy), true) };
};

const minutos = (valor: number | null | undefined): string => {
  if (valor === null || valor === undefined) return '—';
  if (valor < 1) return `${Math.round(valor * 60)} s`;
  return `${valor.toFixed(1)} min`;
};

const porcentaje = (valor: number | null | undefined): string =>
  valor === null || valor === undefined ? '—' : `${valor.toFixed(1)}%`;

const horaTexto = (hora: number | null | undefined): string =>
  hora === null || hora === undefined ? '—' : `${dosDigitos(hora)}:00`;

const horaDeMarca = (marca: string | null): string => {
  if (!marca) return '—';
  const parte = marca.includes('T') ? marca.split('T')[1] : marca.split(' ')[1];
  return parte ? parte.slice(0, 5) : marca;
};

const TONO_ESTADO: Record<string, string> = {
  PENDIENTE: 'border-amber-200 bg-amber-50 text-amber-800',
  EN_PREPARACION: 'border-sky-200 bg-sky-50 text-sky-800',
  LISTO: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  DEVUELTO: 'border-rose-200 bg-rose-50 text-rose-800',
};

const etiquetaEstado = (estado: string): string =>
  estado === 'EN_PREPARACION' ? 'EN PREPARACIÓN' : estado.replace(/_/g, ' ');

const fetchInforme = async <T,>(url: string, signal: AbortSignal): Promise<T> => {
  const respuesta = await fetch(url, { signal, cache: 'no-store' });
  if (!respuesta.ok) {
    let detalle = `HTTP ${respuesta.status}`;
    try {
      const cuerpo = await respuesta.json();
      if (cuerpo && typeof cuerpo.detail === 'string') detalle = cuerpo.detail;
    } catch {
      /* el cuerpo no era JSON: se conserva el código HTTP */
    }
    throw new Error(detalle);
  }
  return (await respuesta.json()) as T;
};

const PRESETS: Array<{ id: RangoId; label: string }> = [
  { id: 'HOY', label: 'Hoy' },
  { id: 'AYER', label: 'Ayer' },
  { id: 'SIETE_DIAS', label: '7 días' },
  { id: 'PERSONALIZADO', label: 'Personalizado' },
];

interface KdsReportsProps {
  onClose: () => void;
  kdsBaseUrl?: string;
}

export default function KdsReports({ onClose, kdsBaseUrl }: KdsReportsProps) {
  const [rango, setRango] = useState<RangoId>('HOY');
  const [personalizado, setPersonalizado] = useState(() => {
    const hoy = fechaLocal(new Date());
    return { desde: hoy, hasta: hoy };
  });
  const [estacion, setEstacion] = useState<string>('');
  const [slaDraft, setSlaDraft] = useState<string>(String(SLA_POR_DEFECTO));
  const [sla, setSla] = useState<number>(SLA_POR_DEFECTO);
  const [datos, setDatos] = useState<InformeKds | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [estacionesConocidas, setEstacionesConocidas] = useState<Array<{ id: string; nombre: string }>>([]);
  const solicitudRef = useRef(0);
  /** Cocina configurada en el ERP: si declara su equipo, los informes van ahí. */
  const [configuredBase, setConfiguredBase] = useState<string | null>(null);
  useEffect(() => {
    let vigente = true;
    void (async () => {
      try {
        const areas = await db.get('productionAreas' as never) as unknown as Parameters<typeof resolveKdsReportsBaseUrlForAreas>[0];
        const resuelto = resolveKdsReportsBaseUrlForAreas(areas);
        if (vigente && resuelto) setConfiguredBase(resuelto);
      } catch {
        /* Sin catálogo de producción: se usa el host de este equipo. */
      }
    })();
    return () => { vigente = false; };
  }, []);

  const cargar = useCallback(async () => {
    const solicitud = solicitudRef.current + 1;
    solicitudRef.current = solicitud;
    const controlador = new AbortController();
    const temporizador = window.setTimeout(() => controlador.abort(), KDS_REPORTS_TIMEOUT_MS);
    const base = resolveKdsReportsBaseUrl(kdsBaseUrl || configuredBase || undefined);
    const { desde, hasta } = buildKdsReportsRange(rango, personalizado);
    const comun = new URLSearchParams({ desde, hasta });
    if (estacion) comun.set('estacion', estacion);
    const conSla = new URLSearchParams(comun);
    conSla.set('sla_minutes', String(sla));

    setCargando(true);
    setError('');
    try {
      const [estados, tiempos, retrasos, desempeno, volumen] = await Promise.all([
        fetchInforme<OrdersByState>(`${base}/api/cocina/informes/orders-by-state?${comun.toString()}`, controlador.signal),
        fetchInforme<PrepTimes>(`${base}/api/cocina/informes/prep-times?${comun.toString()}`, controlador.signal),
        fetchInforme<Delays>(`${base}/api/cocina/informes/delays?${conSla.toString()}`, controlador.signal),
        fetchInforme<StationPerformance>(`${base}/api/cocina/informes/station-performance?${conSla.toString()}`, controlador.signal),
        fetchInforme<HourlyVolume>(`${base}/api/cocina/informes/hourly-volume?${comun.toString()}`, controlador.signal),
      ]);
      if (solicitudRef.current !== solicitud) return;
      setDatos({ estados, tiempos, retrasos, desempeno, volumen });
      if (!estacion) {
        setEstacionesConocidas((previas) => {
          const mapa = new Map(previas.map((item) => [item.id, item]));
          desempeno.estaciones.forEach((item) => mapa.set(item.estacion, { id: item.estacion, nombre: item.nombre }));
          return Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
        });
      }
    } catch (fallo) {
      if (solicitudRef.current !== solicitud) return;
      const sinRespuesta = fallo instanceof TypeError
        || (fallo instanceof Error && /failed to fetch|networkerror|load failed/i.test(fallo.message));
      const mensaje = fallo instanceof Error && fallo.name === 'AbortError'
        ? 'El servicio KDS no respondió a tiempo. Verifica que la cocina esté encendida y en la misma red.'
        : sinRespuesta
          ? `No se pudo contactar el servicio de cocina en ${base}. Verifica que el KDS esté encendido y accesible desde este equipo.`
          : fallo instanceof Error
            ? fallo.message
            : 'Error desconocido al consultar los informes.';
      setDatos(null);
      setError(`No se pudieron cargar los informes de KDS: ${mensaje}`);
    } finally {
      window.clearTimeout(temporizador);
      if (solicitudRef.current === solicitud) setCargando(false);
    }
  }, [rango, personalizado, estacion, sla, kdsBaseUrl, configuredBase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const aplicarSla = () => {
    const numero = Number(slaDraft.replace(',', '.'));
    if (!Number.isFinite(numero) || numero <= 0) {
      setSlaDraft(String(sla));
      return;
    }
    setSla(numero);
  };

  const maximoHoras = useMemo(() => {
    const pedidos = datos?.volumen.por_hora.map((item) => item.pedidos) ?? [];
    return Math.max(1, ...pedidos);
  }, [datos]);

  const sinPedidos = !datos || datos.estados.total_pedidos === 0;
  const hayMarcas = Boolean(datos && datos.tiempos.global.ciclo_total.conteo > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Volver">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-base font-black text-gray-900">Informes de KDS</h2>
            <p className="text-xs text-gray-500">Estados, tiempos, retrasos y volumen de la cocina</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-600">
            <Timer size={14} className="text-gray-400" />
            SLA
            <input
              type="number"
              min={1}
              step={1}
              value={slaDraft}
              onChange={(evento) => setSlaDraft(evento.target.value)}
              onBlur={aplicarSla}
              onKeyDown={(evento) => { if (evento.key === 'Enter') aplicarSla(); }}
              className="w-14 rounded-md border border-gray-200 px-1 py-0.5 text-center text-xs font-black text-gray-800"
              aria-label="Minutos de SLA"
            />
            min
          </label>
          <button
            onClick={() => { void cargar(); }}
            disabled={cargando}
            className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {cargando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setRango(preset.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition-colors ${
                rango === preset.id
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-200'
              }`}
            >
              {preset.label}
            </button>
          ))}
          {rango === 'PERSONALIZADO' && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5">
              <CalendarDays size={14} className="text-gray-400" />
              <input
                type="date"
                value={personalizado.desde}
                onChange={(evento) => setPersonalizado((previa) => ({ ...previa, desde: evento.target.value }))}
                className="rounded-md border border-gray-200 px-2 py-1 text-xs font-bold text-gray-700"
                aria-label="Desde"
              />
              <span className="text-xs font-bold text-gray-400">a</span>
              <input
                type="date"
                value={personalizado.hasta}
                onChange={(evento) => setPersonalizado((previa) => ({ ...previa, hasta: evento.target.value }))}
                className="rounded-md border border-gray-200 px-2 py-1 text-xs font-bold text-gray-700"
                aria-label="Hasta"
              />
            </div>
          )}
          <select
            value={estacion}
            onChange={(evento) => setEstacion(evento.target.value)}
            className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-black text-gray-600"
            aria-label="Estación"
          >
            <option value="">Todas las estaciones</option>
            {estacionesConocidas.map((item) => (
              <option key={item.id} value={item.id}>{item.nombre}</option>
            ))}
          </select>
          {cargando && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-gray-400">
              <Loader2 size={12} className="animate-spin" /> Consultando cocina…
            </span>
          )}
        </div>

        {error && (
          <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
            <p className="text-xs font-bold leading-relaxed text-rose-900">{error}</p>
            <button
              onClick={() => { void cargar(); }}
              className="mt-2 rounded-xl bg-rose-700 px-3 py-2 text-xs font-black text-white"
            >
              Reintentar
            </button>
          </div>
        )}

        {!error && !datos && (
          <p className="rounded-2xl border border-gray-200 bg-white px-4 py-6 text-center text-sm font-bold text-gray-500">
            {cargando ? 'Leyendo los informes de cocina…' : 'Sin datos.'}
          </p>
        )}

        {datos && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <p className="flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-gray-400">
                  <ChefHat size={13} /> Pedidos
                </p>
                <p className="mt-1 text-2xl font-black text-gray-900">{datos.estados.total_pedidos}</p>
                <p className="text-[11px] font-bold text-gray-400">{datos.estados.total_items} ítems enviados</p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <p className="flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-gray-400">
                  <Clock size={13} /> Tiempo medio
                </p>
                <p className="mt-1 text-2xl font-black text-gray-900">
                  {minutos(datos.tiempos.global.ciclo_total.promedio_min)}
                </p>
                <p className="text-[11px] font-bold text-gray-400">
                  recibido → listo · mediana {minutos(datos.tiempos.global.ciclo_total.mediana_min)}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <p className="flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-gray-400">
                  <TriangleAlert size={13} /> Retrasos
                </p>
                <p className="mt-1 text-2xl font-black text-gray-900">{datos.retrasos.pedidos_retrasados}</p>
                <p className="text-[11px] font-bold text-gray-400">
                  {porcentaje(datos.retrasos.porcentaje_retraso)} sobre SLA de {minutos(datos.retrasos.sla_minutes)}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <p className="flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-gray-400">
                  <TrendingUp size={13} /> Hora pico
                </p>
                <p className="mt-1 text-2xl font-black text-gray-900">{horaTexto(datos.volumen.hora_pico)}</p>
                <p className="text-[11px] font-bold text-gray-400">
                  {datos.volumen.total_pedidos} pedidos en el rango
                </p>
              </div>
            </div>

            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-black text-gray-900">
                  <ChefHat size={16} className="text-emerald-700" /> Órdenes por estado
                </h3>
                <div className="flex flex-wrap gap-1">
                  {datos.estados.por_estado.length === 0 && (
                    <span className="text-[11px] font-bold text-gray-400">Sin órdenes en el rango</span>
                  )}
                  {datos.estados.por_estado.map((fila) => (
                    <span
                      key={fila.estado}
                      className={`rounded-full border px-2 py-1 text-[11px] font-black ${TONO_ESTADO[fila.estado] || 'border-gray-200 bg-gray-50 text-gray-700'}`}
                    >
                      {etiquetaEstado(fila.estado)}: {fila.items} · {fila.pedidos} ped.
                    </span>
                  ))}
                </div>
              </header>
              {datos.estados.por_estacion.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-[10px] font-black uppercase tracking-wide text-gray-400">
                        <th className="py-1 pr-2">Estación</th>
                        <th className="py-1 pr-2">Pedidos</th>
                        <th className="py-1 pr-2">Ítems</th>
                        <th className="py-1">Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.estados.por_estacion.map((fila) => (
                        <tr key={fila.estacion} className="border-t border-gray-100">
                          <td className="py-1.5 pr-2 font-black text-gray-800">{fila.nombre}</td>
                          <td className="py-1.5 pr-2 font-bold text-gray-600">{fila.total_pedidos}</td>
                          <td className="py-1.5 pr-2 font-bold text-gray-600">{fila.total_items}</td>
                          <td className="py-1.5">
                            <span className="flex flex-wrap gap-1">
                              {fila.por_estado.map((estado) => (
                                <span key={estado.estado} className="rounded-md bg-gray-50 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
                                  {etiquetaEstado(estado.estado)} {estado.items}
                                </span>
                              ))}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-gray-900">
                <BarChart3 size={16} className="text-emerald-700" /> Desempeño por estación
              </h3>
              {datos.desempeno.estaciones.length === 0 ? (
                <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center text-xs font-bold text-gray-400">
                  {hayMarcas
                    ? 'Sin estaciones con marcas completas en el rango.'
                    : 'Aún no hay ciclos completos (recibido → listo) en el rango seleccionado.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-[10px] font-black uppercase tracking-wide text-gray-400">
                        <th className="py-1 pr-2">Estación</th>
                        <th className="py-1 pr-2">Atendidos</th>
                        <th className="py-1 pr-2">Medio</th>
                        <th className="py-1 pr-2">Mediana</th>
                        <th className="py-1 pr-2">P90</th>
                        <th className="py-1 pr-2">Máx.</th>
                        <th className="py-1">Retrasos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.desempeno.estaciones.map((fila) => (
                        <tr key={fila.estacion} className="border-t border-gray-100">
                          <td className="py-1.5 pr-2 font-black text-gray-800">{fila.nombre}</td>
                          <td className="py-1.5 pr-2 font-bold text-gray-600">{fila.atendidos}</td>
                          <td className="py-1.5 pr-2 font-bold text-gray-600">{minutos(fila.tiempo_medio_min)}</td>
                          <td className="py-1.5 pr-2 font-bold text-gray-600">{minutos(fila.mediana_min)}</td>
                          <td className="py-1.5 pr-2 font-bold text-gray-600">{minutos(fila.p90_min)}</td>
                          <td className="py-1.5 pr-2 font-bold text-gray-600">{minutos(fila.maximo_min)}</td>
                          <td className="py-1.5">
                            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-black ${
                              fila.retrasados > 0
                                ? 'border-rose-200 bg-rose-50 text-rose-800'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            }`}>
                              {fila.retrasados} · {porcentaje(fila.porcentaje_retraso)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-[11px] font-bold text-gray-400">
                Preparación (inicio → listo): media {minutos(datos.tiempos.global.preparacion.promedio_min)} ·
                mediana {minutos(datos.tiempos.global.preparacion.mediana_min)} ·
                máximo {minutos(datos.tiempos.global.preparacion.maximo_min)} ·
                {datos.tiempos.global.preparacion.conteo} ítems medidos
              </p>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-gray-900">
                <TrendingUp size={16} className="text-emerald-700" /> Volumen por hora
              </h3>
              {datos.volumen.total_pedidos === 0 ? (
                <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center text-xs font-bold text-gray-400">
                  Sin pedidos registrados en el rango seleccionado.
                </p>
              ) : (
                <>
                  <div className="flex h-32 items-end gap-1">
                    {datos.volumen.por_hora.map((hora) => {
                      const alto = Math.round((hora.pedidos / maximoHoras) * 100);
                      return (
                        <div key={hora.hora} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                          <div className="flex h-24 w-full items-end">
                            <div
                              className={`w-full rounded-t-md ${hora.pedidos > 0 ? 'bg-emerald-600' : 'bg-gray-100'}`}
                              style={{ height: `${Math.max(hora.pedidos > 0 ? 6 : 2, alto)}%` }}
                              title={`${horaTexto(hora.hora)} · ${hora.pedidos} pedidos`}
                            />
                          </div>
                          <span className="text-[9px] font-bold text-gray-400">
                            {hora.hora % 3 === 0 ? dosDigitos(hora.hora) : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {datos.volumen.por_estacion.map((fila) => (
                      <span key={fila.estacion} className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-black text-gray-600">
                        {fila.nombre}: {fila.total_pedidos}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-black text-gray-900">
                  <TriangleAlert size={16} className="text-rose-600" /> Retrasos
                </h3>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-black text-gray-600">
                  SLA {minutos(datos.retrasos.sla_minutes)} · {datos.retrasos.items_retrasados} de {datos.retrasos.items_medidos} ítems
                </span>
              </header>
              {datos.retrasos.mas_tardios.length === 0 ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-center text-xs font-bold text-emerald-800">
                  Ningún pedido superó el SLA de {minutos(datos.retrasos.sla_minutes)} en el rango.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-[10px] font-black uppercase tracking-wide text-gray-400">
                        <th className="py-1 pr-2">Orden</th>
                        <th className="py-1 pr-2">Estación</th>
                        <th className="py-1 pr-2">Recibido</th>
                        <th className="py-1 pr-2">Listo</th>
                        <th className="py-1 pr-2">Espera</th>
                        <th className="py-1">SLA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.retrasos.mas_tardios.map((fila) => (
                        <tr key={fila.detalle_id} className="border-t border-gray-100">
                          <td className="py-1.5 pr-2 font-black text-gray-800">{fila.orden_id}</td>
                          <td className="py-1.5 pr-2 font-bold text-gray-600">{fila.nombre}</td>
                          <td className="py-1.5 pr-2 font-bold text-gray-500">{horaDeMarca(fila.recibido_at)}</td>
                          <td className="py-1.5 pr-2 font-bold text-gray-500">{horaDeMarca(fila.listo_at)}</td>
                          <td className="py-1.5 pr-2 font-black text-rose-700">{minutos(fila.espera_min)}</td>
                          <td className="py-1.5 font-bold text-gray-500">{minutos(fila.sla_minutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {datos.retrasos.por_estacion.some((fila) => fila.items_retrasados > 0) && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {datos.retrasos.por_estacion
                    .filter((fila) => fila.items_retrasados > 0)
                    .map((fila) => (
                      <span key={fila.estacion} className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-800">
                        {fila.nombre}: {fila.items_retrasados} ({porcentaje(fila.porcentaje_retraso)})
                      </span>
                    ))}
                </div>
              )}
            </section>

            {sinPedidos && (
              <p className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-4 text-center text-xs font-bold text-gray-500">
                No hay órdenes de cocina en el rango seleccionado. Prueba con «7 días» o un rango personalizado.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
