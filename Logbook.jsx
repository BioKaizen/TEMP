/**
 * LogBook.jsx — BioKaizen Solutions / UPGES v1
 * Lista de vuelos completados — Log Book AESA
 *
 * Exportación PDF (Apéndice M AESA):
 *   - Botón "Seleccionar" activa modo selección con checkboxes en cada fila
 *   - Botón "↗ PDF (N)" cuando hay vuelos seleccionados
 *   - Botón individual "EXPORTAR PDF AESA" en el detalle de cada vuelo
 *
 * Filtros PRO:
 *   - Móvil: botón "Filtros (N)" → modal con <select> nativos
 *   - Desktop (lg+): chips horizontales con dropdowns
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, ChevronDown, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { getAllFlights, deleteFlight, EVENT_FLIGHTS_UPDATED } from '../../db/flightOpsDB';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatDuracion, ENTORNO } from '../../db/flightModels';
import { exportFlightsPDF, exportSingleFlightPDF } from '../../flightOpsPDF';

// Helper de estilos
const fo = (cockpitMode) => (cockpit, theme) => cockpitMode ? cockpit : theme;

// ─── Constantes ───────────────────────────────────────────────────────────

const DURACION_OPTIONS = [
  { value: '15', label: '≥ 15 minutos' },
  { value: '30', label: '≥ 30 minutos' },
  { value: '45', label: '≥ 45 minutos' },
  { value: '60', label: '≥ 1 hora' },
  { value: '90', label: '≥ 1h 30 min' },
  { value: '120', label: '≥ 2 horas' },
];

const FECHA_PRESETS = [
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mes' },
  { value: 'quarter', label: 'Este trimestre' },
  { value: 'year', label: 'Este año' },
];

const EMPTY_FILTERS = {
  fechaPreset: '', fechaDesde: '', fechaHasta: '',
  aeronave: '', actividad: '', duracionMin: '',
  entorno: '', funcionPiloto: '',
};

// ─── FilterChip — desktop ─────────────────────────────────────────────────

function FilterChip({ label, activeLabel, onClear, cockpitMode, children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const isActive = !!activeLabel;
  const c = fo(cockpitMode);

  useEffect(() => {
    const handler = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((v) => !v);
  };

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className={[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all whitespace-nowrap',
          isActive
            ? c('border-[#7eb8d4]/60 bg-[#7eb8d4]/10 text-[#7eb8d4]', 'border-primary/60 bg-primary/10 text-primary')
            : c('border-[#2a4258] bg-[#070b10] text-[#8aa8c4] hover:border-[#3e6585]', 'glass border-white/10 text-muted-foreground hover:border-primary/50 hover:text-foreground'),
        ].join(' ')}
      >
        {isActive ? activeLabel : label}
        {isActive ? (
          <span onClick={(e) => { e.stopPropagation(); onClear(); setOpen(false); }} className="ml-0.5 hover:opacity-60 transition-opacity">
            <X className="w-3 h-3" />
          </span>
        ) : (
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>
      {open && (
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className={[
            'rounded-xl shadow-xl min-w-[180px] max-h-64 overflow-y-auto border',
            c('bg-[#0c1218] border-[#2a4258]', 'bg-popover border-border'),
          ].join(' ')}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function ChipOption({ label, active, onSelect, cockpitMode }) {
  const c = fo(cockpitMode);
  return (
    <button
      onClick={onSelect}
      className={[
        'w-full text-left px-4 py-2.5 text-sm transition-colors',
        active
          ? c('bg-[#7eb8d4]/10 text-[#7eb8d4] font-semibold', 'bg-primary/15 text-primary font-semibold')
          : c('text-[#c8d8e8] hover:bg-[#16283a]', 'text-foreground hover:bg-primary/10'),
      ].join(' ')}
    >
      {label}
    </button>
  );
}

// ─── FilterChipBar — solo desktop (lg+) ──────────────────────────────────

function FilterChipBar({ filters, setFilters, flights, cockpitMode }) {
  const c = fo(cockpitMode);

  const uniqueAeronaves = useMemo(() => [...new Set(flights.map((f) => f.droneSnapshot?.alias).filter(Boolean))].sort(), [flights]);
  const uniqueActividades = useMemo(() => [...new Set(flights.map((f) => f.actividad).filter(Boolean))].sort(), [flights]);
  const uniqueFunciones = useMemo(() => [...new Set(flights.map((f) => f.funcionPiloto).filter(Boolean))].sort(), [flights]);

  const set = (key, val) => setFilters((f) => ({ ...f, [key]: val }));
  const clear = (key) => setFilters((f) => ({ ...f, [key]: '' }));

  const fechaActiveLabel = useMemo(() => {
    if (filters.fechaPreset) return FECHA_PRESETS.find((p) => p.value === filters.fechaPreset)?.label;
    if (filters.fechaDesde && filters.fechaHasta) return `${filters.fechaDesde} → ${filters.fechaHasta}`;
    if (filters.fechaDesde) return `Desde ${filters.fechaDesde}`;
    if (filters.fechaHasta) return `Hasta ${filters.fechaHasta}`;
    return null;
  }, [filters.fechaPreset, filters.fechaDesde, filters.fechaHasta]);

  const clearFecha = () => setFilters((f) => ({ ...f, fechaPreset: '', fechaDesde: '', fechaHasta: '' }));

  const inputCls = c(
    'w-full px-2 py-1.5 text-xs bg-[#070b10] border border-[#2a4258] rounded text-[#c8d8e8] focus:outline-none focus:border-[#7eb8d4]',
    'w-full px-2 py-1.5 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary',
  );

  const dividerCls = c('border-t border-[#2a4258]', 'border-t border-border');
  const hasActive = Object.entries(filters).some(([, v]) => !!v);

  return (
    <div className="hidden lg:flex gap-2 px-4 py-2 overflow-x-auto">
      <FilterChip label="Fecha" activeLabel={fechaActiveLabel} onClear={clearFecha} cockpitMode={cockpitMode}>
        <div className="p-2 space-y-0.5">
          {FECHA_PRESETS.map((p) => (
            <ChipOption key={p.value} label={p.label} active={filters.fechaPreset === p.value}
              onSelect={() => setFilters((f) => ({ ...f, fechaPreset: p.value, fechaDesde: '', fechaHasta: '' }))}
              cockpitMode={cockpitMode} />
          ))}
          <div className={dividerCls + ' my-1'} />
          <div className="px-2 pb-1 space-y-1.5">
            <p className={c('text-[10px] text-[#8aa8c4]', 'text-xs text-muted-foreground')}>Rango personalizado</p>
            <input type="date" value={filters.fechaDesde} onChange={(e) => setFilters((f) => ({ ...f, fechaDesde: e.target.value, fechaPreset: '' }))} className={inputCls} />
            <input type="date" value={filters.fechaHasta} onChange={(e) => setFilters((f) => ({ ...f, fechaHasta: e.target.value, fechaPreset: '' }))} className={inputCls} />
          </div>
        </div>
      </FilterChip>

      {uniqueAeronaves.length > 0 && (
        <FilterChip label="Aeronave" activeLabel={filters.aeronave || null} onClear={() => clear('aeronave')} cockpitMode={cockpitMode}>
          {uniqueAeronaves.map((a) => <ChipOption key={a} label={a} active={filters.aeronave === a} onSelect={() => set('aeronave', a)} cockpitMode={cockpitMode} />)}
        </FilterChip>
      )}

      {uniqueActividades.length > 0 && (
        <FilterChip label="Actividad" activeLabel={filters.actividad || null} onClear={() => clear('actividad')} cockpitMode={cockpitMode}>
          {uniqueActividades.map((a) => <ChipOption key={a} label={a} active={filters.actividad === a} onSelect={() => set('actividad', a)} cockpitMode={cockpitMode} />)}
        </FilterChip>
      )}

      <FilterChip label="Duración" activeLabel={filters.duracionMin ? DURACION_OPTIONS.find((d) => d.value === filters.duracionMin)?.label : null} onClear={() => clear('duracionMin')} cockpitMode={cockpitMode}>
        {DURACION_OPTIONS.map((d) => <ChipOption key={d.value} label={d.label} active={filters.duracionMin === d.value} onSelect={() => set('duracionMin', d.value)} cockpitMode={cockpitMode} />)}
      </FilterChip>

      <FilterChip label="Entorno" activeLabel={filters.entorno || null} onClear={() => clear('entorno')} cockpitMode={cockpitMode}>
        {ENTORNO.map((e) => <ChipOption key={e} label={e} active={filters.entorno === e} onSelect={() => set('entorno', e)} cockpitMode={cockpitMode} />)}
      </FilterChip>

      {uniqueFunciones.length > 0 && (
        <FilterChip label="Función" activeLabel={filters.funcionPiloto || null} onClear={() => clear('funcionPiloto')} cockpitMode={cockpitMode}>
          {uniqueFunciones.map((f) => <ChipOption key={f} label={f} active={filters.funcionPiloto === f} onSelect={() => set('funcionPiloto', f)} cockpitMode={cockpitMode} />)}
        </FilterChip>
      )}

      {hasActive && (
        <button onClick={() => setFilters(EMPTY_FILTERS)}
          className={c('flex-shrink-0 px-3 py-1.5 text-xs text-[#ff4444]/70 hover:text-[#ff4444] transition-colors whitespace-nowrap', 'flex-shrink-0 px-3 py-1.5 text-xs text-destructive/60 hover:text-destructive transition-colors whitespace-nowrap')}>
          Limpiar todo
        </button>
      )}
    </div>
  );
}

// ─── FilterModal — solo móvil ─────────────────────────────────────────────

function FilterModal({ open, onClose, filters, onApply, flights, cockpitMode }) {
  const [local, setLocal] = useState(filters);
  const c = fo(cockpitMode);

  useEffect(() => { if (open) setLocal(filters); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, val) => setLocal((f) => ({ ...f, [key]: val }));

  const uniqueAeronaves = [...new Set(flights.map((f) => f.droneSnapshot?.alias).filter(Boolean))].sort();
  const uniqueActividades = [...new Set(flights.map((f) => f.actividad).filter(Boolean))].sort();
  const uniqueFunciones = [...new Set(flights.map((f) => f.funcionPiloto).filter(Boolean))].sort();

  const activeCount = Object.entries(local).filter(([, v]) => !!v).length;

  const selectCls = c(
    'w-full px-3 py-2.5 border border-[#2a4258] rounded text-sm bg-[#070b10] text-[#c8d8e8] appearance-none focus:outline-none focus:border-[#7eb8d4]',
    'w-full px-3 py-2.5 border border-border rounded-lg text-sm bg-background text-foreground appearance-none focus:outline-none focus:border-primary',
  );

  const labelCls = c(
    'block text-[10px] tracking-[0.2em] text-[#8aa8c4] mb-1.5 uppercase',
    'block text-xs font-medium text-muted-foreground mb-1.5',
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={c(
        'w-full max-w-sm bg-[#0c1218] border border-[#2a4258] rounded-2xl max-h-[85vh] flex flex-col',
        'w-full max-w-sm glass border border-white/10 rounded-2xl max-h-[85vh] flex flex-col',
      )}>
        <div className={c('flex items-center justify-between px-4 py-3 border-b border-[#16283a] shrink-0', 'flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0')}>
          <p className={c('text-[13px] tracking-[0.15em] font-semibold text-[#7eb8d4]', 'text-sm font-semibold text-foreground')}>
            {c('FILTROS', 'Filtros')}{activeCount > 0 ? ` (${activeCount})` : ''}
          </p>
          <button onClick={onClose} className={c('text-[#8aa8c4] hover:text-[#7ea8c4] transition-colors', 'text-muted-foreground hover:text-foreground transition-colors')}>✕</button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4 flex-1">
          <div>
            <label className={labelCls}>Fecha</label>
            <select value={local.fechaPreset}
              onChange={(e) => setLocal((f) => ({ ...f, fechaPreset: e.target.value, fechaDesde: '', fechaHasta: '' }))}
              className={selectCls}>
              <option value="">Sin filtro</option>
              {FECHA_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {!local.fechaPreset && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <input type="date" value={local.fechaDesde} onChange={(e) => set('fechaDesde', e.target.value)} className={selectCls} />
                <input type="date" value={local.fechaHasta} onChange={(e) => set('fechaHasta', e.target.value)} className={selectCls} />
              </div>
            )}
          </div>

          {uniqueAeronaves.length > 0 && (
            <div>
              <label className={labelCls}>Aeronave</label>
              <select value={local.aeronave} onChange={(e) => set('aeronave', e.target.value)} className={selectCls}>
                <option value="">Todas</option>
                {uniqueAeronaves.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}

          {uniqueActividades.length > 0 && (
            <div>
              <label className={labelCls}>Actividad</label>
              <select value={local.actividad} onChange={(e) => set('actividad', e.target.value)} className={selectCls}>
                <option value="">Todas</option>
                {uniqueActividades.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={labelCls}>Duración mínima</label>
            <select value={local.duracionMin} onChange={(e) => set('duracionMin', e.target.value)} className={selectCls}>
              <option value="">Sin filtro</option>
              {DURACION_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>Entorno</label>
            <select value={local.entorno} onChange={(e) => set('entorno', e.target.value)} className={selectCls}>
              <option value="">Todos</option>
              {ENTORNO.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          {uniqueFunciones.length > 0 && (
            <div>
              <label className={labelCls}>Función piloto</label>
              <select value={local.funcionPiloto} onChange={(e) => set('funcionPiloto', e.target.value)} className={selectCls}>
                <option value="">Todas</option>
                {uniqueFunciones.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className={c('flex gap-2 px-4 py-3 border-t border-[#16283a] shrink-0', 'flex gap-2 px-4 py-3 border-t border-white/10 shrink-0')}>
          <button onClick={() => setLocal(EMPTY_FILTERS)}
            className={c(
              'flex-1 py-2.5 text-[11px] tracking-[0.15em] rounded border border-[#2a4258] text-[#8aa8c4] hover:border-[#3e6585] transition-colors',
              'flex-1 py-2.5 text-xs rounded-lg border border-border text-muted-foreground hover:border-primary/50 transition-colors',
            )}>
            {c('LIMPIAR', 'Limpiar')}
          </button>
          <button onClick={() => { onApply(local); onClose(); }}
            className="flex-1 py-2.5 text-xs rounded-lg bg-[#00c896]/10 border border-[#00c896]/40 text-[#00c896] hover:bg-[#00c896]/15 transition-colors font-semibold">
            {c('APLICAR', 'Aplicar')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── applyFilters ─────────────────────────────────────────────────────────

function applyFilters(flights, filters) {
  return flights.filter((f) => {
    if (filters.fechaPreset) {
      const now = new Date();
      const fecha = new Date(f.fecha + 'T12:00:00');
      if (filters.fechaPreset === 'week' && fecha < new Date(now - 7 * 24 * 60 * 60 * 1000)) return false;
      if (filters.fechaPreset === 'month' && (fecha.getMonth() !== now.getMonth() || fecha.getFullYear() !== now.getFullYear())) return false;
      if (filters.fechaPreset === 'quarter' && (Math.floor(fecha.getMonth() / 3) !== Math.floor(now.getMonth() / 3) || fecha.getFullYear() !== now.getFullYear())) return false;
      if (filters.fechaPreset === 'year' && fecha.getFullYear() !== now.getFullYear()) return false;
    } else if (filters.fechaDesde || filters.fechaHasta) {
      const fecha = new Date(f.fecha + 'T12:00:00');
      if (filters.fechaDesde && fecha < new Date(filters.fechaDesde + 'T00:00:00')) return false;
      if (filters.fechaHasta && fecha > new Date(filters.fechaHasta + 'T23:59:59')) return false;
    }
    if (filters.aeronave && f.droneSnapshot?.alias !== filters.aeronave) return false;
    if (filters.actividad && f.actividad !== filters.actividad) return false;
    if (filters.duracionMin && (f.duracionMinutos ?? 0) < Number(filters.duracionMin)) return false;
    if (filters.entorno && f.condicionesOp?.entorno !== filters.entorno) return false;
    if (filters.funcionPiloto && f.funcionPiloto !== filters.funcionPiloto) return false;
    return true;
  });
}

// ─── LogBook ──────────────────────────────────────────────────────────────

export default function LogBook({ cockpitMode = true }) {
  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [pendingDeleteFlight, setPendingDeleteFlight] = useState(null);
  const [selected, setSelected] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [exporting, setExporting] = useState(false);

  const loadFlights = async () => {
    try {
      const all = await getAllFlights();
      all.sort((a, b) => b.createdAt?.localeCompare(a.createdAt ?? '') ?? 0);
      setFlights(all);
    } catch (e) {
      console.error('[LogBook] Error cargando vuelos:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFlights();
    window.addEventListener(EVENT_FLIGHTS_UPDATED, loadFlights);
    return () => window.removeEventListener(EVENT_FLIGHTS_UPDATED, loadFlights);
  }, []);

  const filtered = useMemo(() => applyFilters(flights, filters), [flights, filters]);
  const activeFilterCount = useMemo(() => Object.entries(filters).filter(([, v]) => !!v).length, [filters]);

  const toggleSelectionMode = () => { setSelectionMode((v) => !v); setSelectedIds(new Set()); };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(filtered.map((f) => f.id)));

  const handleExportSelected = async () => {
    const toExport = flights.filter((f) => selectedIds.has(f.id));
    if (!toExport.length) return;
    setExporting(true);
    try {
      const result = await exportFlightsPDF(toExport);
      if (result) {
        toast.success(`PDF guardado en ${result.location}`, { description: result.filename });
        setSelectionMode(false);
        setSelectedIds(new Set());
      }
    } catch (e) {
      console.error('[LogBook] Error exportando PDF:', e);
      toast.error('Error al generar el PDF');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteClick = (flight) => {
    setPendingDeleteFlight(flight);
  };

  const confirmDelete = async (flight) => {
    try {
      await deleteFlight(flight.id);
      if (selected?.id === flight.id) setSelected(null);
      setPendingDeleteFlight(null);
    } catch (e) {
      console.error('[LogBook] Error eliminando vuelo:', e);
      toast.error('Error al eliminar el vuelo');
    }
  };

  const handleExportSingle = async (flight) => {
    setExporting(true);
    try {
      const result = await exportSingleFlightPDF(flight);
      if (result) {
        toast.success(`PDF guardado en ${result.location}`, { description: result.filename });
      }
    } catch (e) {
      console.error('[LogBook] Error exportando PDF:', e);
      toast.error('Error al generar el PDF');
    } finally {
      setExporting(false);
    }
  };

  const c = fo(cockpitMode);

  if (loading) {
    return (
      <div className={c('flex items-center justify-center h-40 text-[#5a7a9a] text-xs tracking-widest', 'flex items-center justify-center h-40 text-muted-foreground text-xs')}>
        CARGANDO LOG...
      </div>
    );
  }

  // ── AlertDialog de confirmación de borrado — igual que ExamHistory ────
  const DeleteDialog = () => (
    <AlertDialog open={pendingDeleteFlight !== null} onOpenChange={(open) => !open && setPendingDeleteFlight(null)}>
      <AlertDialogContent className="glass border-white/10">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">¿Eliminar este vuelo?</AlertDialogTitle>
          <AlertDialogDescription>
            Se eliminará "{pendingDeleteFlight?.actividad || 'Sin actividad'}" del {pendingDeleteFlight?.fecha ?? ''}. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => confirmDelete(pendingDeleteFlight)} className="bg-red-600 hover:bg-red-700">Eliminar</AlertDialogAction>
          <AlertDialogCancel className="border-white/10">Cancelar</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // ── Barra móvil ────────────────────────────────────────────────
  const MobileBar = () => (
    <div className={c('lg:hidden flex items-center justify-between px-4 py-2 border-b border-[#16283a]', 'lg:hidden flex items-center justify-between px-4 py-2')}>
      <button
        onClick={() => setFilterModalOpen(true)}
        className={[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
          activeFilterCount > 0
            ? c('border-[#7eb8d4]/60 bg-[#7eb8d4]/10 text-[#7eb8d4]', 'border-primary/60 bg-primary/10 text-primary')
            : c('border-[#2a4258] bg-[#070b10] text-[#8aa8c4]', 'glass border-white/10 text-muted-foreground'),
        ].join(' ')}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        {activeFilterCount > 0 ? `Filtros (${activeFilterCount})` : 'Filtros'}
      </button>
      <div className="flex items-center gap-2">
        {selectionMode && filtered.length > 0 && (
          <button onClick={selectAll} className={c('px-2 py-1 text-[10px] text-[#8aa8c4] hover:text-[#7eb8d4] transition-colors', 'px-2 py-1 text-xs text-muted-foreground hover:text-primary transition-colors')}>
            {c('TODOS', 'Todos')}
          </button>
        )}
        {selectionMode && selectedIds.size > 0 && (
          <button onClick={handleExportSelected} disabled={exporting}
            className="px-3 py-1 text-xs rounded-full border border-[#00c896]/40 text-[#00c896] bg-[#00c896]/5 hover:bg-[#00c896]/10 transition-colors disabled:opacity-50">
            {exporting ? '···' : `↗ PDF (${selectedIds.size})`}
          </button>
        )}
        <button onClick={toggleSelectionMode}
          className={[
            'px-3 py-1 text-xs rounded-full border transition-colors',
            selectionMode
              ? c('border-[#7eb8d4]/60 text-[#7eb8d4] bg-[#7eb8d4]/5', 'border-primary/60 text-primary bg-primary/5')
              : c('border-[#2a4258] text-[#8aa8c4] hover:border-[#3e6585]', 'border-border text-muted-foreground hover:border-primary/50'),
          ].join(' ')}>
          {selectionMode ? c('CANCELAR', 'Cancelar') : c('SELECCIONAR', 'Seleccionar')}
        </button>
      </div>
    </div>
  );

  // ── Barra desktop ──────────────────────────────────────────────
  const DesktopBar = () => (
    <div className="hidden lg:flex items-center justify-between pr-4">
      <FilterChipBar filters={filters} setFilters={setFilters} flights={flights} cockpitMode={cockpitMode} />
      <div className="flex items-center gap-2 flex-shrink-0">
        {selectionMode && filtered.length > 0 && (
          <button onClick={selectAll} className={c('px-2 py-1 text-[10px] text-[#8aa8c4] hover:text-[#7eb8d4] transition-colors', 'px-2 py-1 text-xs text-muted-foreground hover:text-primary transition-colors')}>
            {c('TODOS', 'Todos')}
          </button>
        )}
        {selectionMode && selectedIds.size > 0 && (
          <button onClick={handleExportSelected} disabled={exporting}
            className="px-3 py-1 text-xs rounded-full border border-[#00c896]/40 text-[#00c896] bg-[#00c896]/5 hover:bg-[#00c896]/10 transition-colors disabled:opacity-50">
            {exporting ? '···' : `↗ PDF (${selectedIds.size})`}
          </button>
        )}
        <button onClick={toggleSelectionMode}
          className={[
            'px-3 py-1 text-xs rounded-full border transition-colors',
            selectionMode
              ? c('border-[#7eb8d4]/60 text-[#7eb8d4] bg-[#7eb8d4]/5', 'border-primary/60 text-primary bg-primary/5')
              : c('border-[#2a4258] text-[#8aa8c4] hover:border-[#3e6585]', 'border-border text-muted-foreground hover:border-primary/50'),
          ].join(' ')}>
          {selectionMode ? c('CANCELAR', 'Cancelar') : c('SELECCIONAR', 'Seleccionar')}
        </button>
      </div>
    </div>
  );

  // ── COCKPIT layout ─────────────────────────────────────────────
  if (cockpitMode) {
    return (
      <div className="flex flex-col h-full relative">
        <MobileBar />
        <DesktopBar />
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? <EmptyState cockpitMode /> : filtered.map((flight) => (
            <FlightListItem key={flight.id} flight={flight} selectionMode={selectionMode}
              isSelected={selectedIds.has(flight.id)} onSelect={() => toggleSelect(flight.id)}
              onOpen={() => { if (!selectionMode) setSelected(flight); }}
              onDelete={handleDeleteClick} cockpitMode />
          ))}
        </div>
        {selected && !selectionMode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-[#0c1218] border border-[#2a4258] rounded-2xl max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#16283a] shrink-0">
                <div>
                  <p className="text-[10px] tracking-[0.2em] text-[#8aa8c4]">DETALLE DE VUELO</p>
                  <p className="text-[14px] tracking-[0.15em] text-[#7ea8c4] truncate max-w-[240px]">{selected.actividad || 'Sin actividad'}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-[#8aa8c4] text-xl hover:text-[#7ea8c4] transition-colors ml-3 shrink-0">✕</button>
              </div>
              <div className="overflow-y-auto p-4">
                <FlightDetail flight={selected} onExport={() => handleExportSingle(selected)} exporting={exporting} cockpitMode />
              </div>
            </div>
          </div>
        )}
        <FilterModal open={filterModalOpen} onClose={() => setFilterModalOpen(false)}
          filters={filters} onApply={setFilters} flights={flights} cockpitMode />
        <DeleteDialog />
      </div>
    );
  }

  // ── TEMA layout ────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full relative">
      <MobileBar />
      <DesktopBar />
      <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2">
        {filtered.length === 0 ? (
          <EmptyState cockpitMode={false} />
        ) : (
          <div className="space-y-2">
            {filtered.map((flight) => (
              <FlightListItem key={flight.id} flight={flight} selectionMode={selectionMode}
                isSelected={selectedIds.has(flight.id)} onSelect={() => toggleSelect(flight.id)}
                onOpen={() => { if (!selectionMode) setSelected(flight); }}
                onDelete={handleDeleteClick} cockpitMode={false} />
            ))}
          </div>
        )}
      </div>
      {selected && !selectionMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md glass border border-white/10 rounded-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
              <div>
                <p className="text-xs text-muted-foreground">Detalle de vuelo</p>
                <p className="text-sm font-medium text-foreground truncate max-w-[240px]">{selected.actividad || 'Sin actividad'}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-muted-foreground text-xl hover:text-foreground transition-colors ml-3 shrink-0">✕</button>
            </div>
            <div className="overflow-y-auto p-4">
              <FlightDetail flight={selected} onExport={() => handleExportSingle(selected)} exporting={exporting} cockpitMode={false} />
            </div>
          </div>
        </div>
      )}
      <FilterModal open={filterModalOpen} onClose={() => setFilterModalOpen(false)}
        filters={filters} onApply={setFilters} flights={flights} cockpitMode={false} />
      <DeleteDialog />
    </div>
  );
}

// ─── FlightListItem ──────────────────────────────────────────────────────

function FlightListItem({ flight, selectionMode, isSelected, onSelect, onOpen, onDelete, cockpitMode = true }) {
  const condIcon = flight.condicionesOp?.horaria === 'N' ? '☽' : '☀';

  if (cockpitMode) {
    return (
      <button onClick={selectionMode ? onSelect : onOpen}
        className={['w-full flex items-stretch gap-3 px-4 py-3 border-b border-[#0a1018] transition-colors text-left',
          selectionMode ? isSelected ? 'bg-[#7eb8d4]/5' : 'hover:bg-[#0c1520]' : 'hover:bg-[#0c1520]',
        ].join(' ')}>
        {selectionMode && (
          <div className="flex items-center shrink-0">
            <div className={['w-5 h-5 rounded border-2 flex items-center justify-center transition-colors', isSelected ? 'border-[#7eb8d4] bg-[#7eb8d4]/20' : 'border-[#2a4258]'].join(' ')}>
              {isSelected && <span className="text-[#7eb8d4] text-xs">✓</span>}
            </div>
          </div>
        )}
        <div className="flex flex-col items-center justify-center w-10 shrink-0">
          <span className="text-[16px] font-semibold text-[#7ea8c4] tabular-nums leading-none">{flight.fecha?.slice(8) ?? '--'}</span>
          <span className="text-[9px] tracking-wider text-[#8aa8c4] uppercase">
            {flight.fecha ? new Date(flight.fecha + 'T12:00:00').toLocaleString('es-ES', { month: 'short' }) : '---'}
          </span>
        </div>
        <div className="w-px bg-[#2a4258] self-stretch" />
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className="text-[12px] text-[#7ea8c4] tracking-wider truncate">{flight.actividad || 'Sin actividad'}</span>
          <span className="text-[11px] text-[#8aa8c4] tracking-wider truncate">
            {flight.fecha?.slice(5).replace('-', '/') ?? '--'} {flight.horaInicio ?? ''} · {flight.droneSnapshot?.alias || 'Sin aeronave'}{flight.condicionesOp?.entorno ? ` · ${flight.condicionesOp.entorno}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[13px] tabular-nums text-[#5a8aaa]">{formatDuracion(flight.duracionMinutos)}</span>
          <span className="text-[9px] tracking-[0.15em] text-[#5a7a9a]">{flight.funcionPiloto ?? 'PIC'}</span>
          <span className="text-[10px] text-[#8aa8c4]">{condIcon}</span>
          {!selectionMode && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(flight); }}
              className="ml-1 p-1 rounded text-[#5a7a9a] hover:text-[#ff4444] hover:bg-[#ff4444]/10 transition-colors"
              title="Eliminar vuelo">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </button>
    );
  }

  return (
    <button onClick={selectionMode ? onSelect : onOpen}
      className={['w-full glass rounded-xl border border-white/10 flex items-center justify-between gap-3 py-3 px-4 text-left transition-colors',
        isSelected ? 'bg-primary/10 border-primary/30' : 'hover:bg-white/15',
      ].join(' ')}>
      <div className="flex items-center gap-3 min-w-0">
        {selectionMode && (
          <div className={['w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0', isSelected ? 'border-primary bg-primary/20' : 'border-border'].join(' ')}>
            {isSelected && <span className="text-primary text-xs">✓</span>}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{flight.actividad || 'Sin actividad'}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
            <Calendar className="w-3 h-3 flex-shrink-0" />
            {flight.fecha ? new Date(flight.fecha + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
            {flight.horaInicio && <span>· {flight.horaInicio}</span>}
            {flight.droneSnapshot?.alias && <span className="truncate">· {flight.droneSnapshot.alias}</span>}
            {flight.condicionesOp?.entorno && <span className="truncate">· {flight.condicionesOp.entorno}</span>}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="font-mono font-bold text-sm text-foreground">{formatDuracion(flight.duracionMinutos)}</span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{flight.funcionPiloto ?? 'PIC'}</span>
        <span className="text-base">{condIcon}</span>
        {!selectionMode && (
          <button onClick={(e) => { e.stopPropagation(); onDelete(flight); }}
            className="ml-1 p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Eliminar vuelo">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </button>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────

function EmptyState({ cockpitMode = true }) {
  const c = fo(cockpitMode);
  return (
    <div className={c('flex flex-col items-center justify-center h-40 gap-2', 'glass rounded-xl border border-white/10 flex flex-col items-center justify-center py-10 gap-2')}>
      <span className={c('text-3xl text-[#2a4258]', 'text-3xl text-muted-foreground/30')}>◉</span>
      <p className={c('text-[10px] tracking-[0.2em] text-[#5a7a9a]', 'text-sm text-muted-foreground')}>Sin vuelos registrados</p>
      <p className={c('text-[10px] text-[#3a5a7a]', 'text-xs text-muted-foreground/60')}>Inicia un vuelo desde SESIÓN</p>
    </div>
  );
}

// ─── FlightDetail ─────────────────────────────────────────────────────────

function FlightDetail({ flight, onExport, exporting, cockpitMode = true }) {
  const c = fo(cockpitMode);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          ['FECHA', flight.fecha],
          ['INICIO (local)', flight.horaInicio],
          ['INICIO (UTC)', flight.horaInicioUTC ?? '—'],
          ['FIN (local)', flight.horaFin],
          ['FIN (UTC)', flight.horaFinUTC ?? '—'],
          ['DURACIÓN', formatDuracion(flight.duracionMinutos)],
          ['ATERRIZAJES', `${flight.numAterrizajes} (D:${flight.aterrizajesDia ?? 0} / N:${flight.aterrizajesNoche ?? 0})`],
          ['FUNCIÓN', flight.funcionPiloto],
          ['CONDICIONES', `${flight.condicionesOp?.horaria} · ${flight.condicionesOp?.visual}`],
          ['ENTORNO', flight.condicionesOp?.entorno || '—'],
          ['LUGAR', flight.lugar || '—'],
        ].map(([label, value]) => (
          <div key={label} className={c('p-3 border border-[#16283a] bg-[#070b10] rounded', 'glass rounded-xl border border-white/10 p-3')}>
            <p className={c('text-[9px] tracking-[0.2em] text-[#5a7a9a] mb-1', 'text-xs text-muted-foreground mb-1')}>{label}</p>
            <p className={c('text-[12px] text-[#7ea8c4]', 'text-sm font-medium text-foreground')}>{value ?? '—'}</p>
          </div>
        ))}
      </div>

      <div className={c('p-3 border border-[#16283a] bg-[#070b10] rounded', 'glass rounded-xl border border-white/10 p-3')}>
        <p className={c('text-[9px] tracking-[0.2em] text-[#5a7a9a] mb-1', 'text-xs text-muted-foreground mb-1')}>AERONAVE</p>
        {flight.droneSnapshot?.alias ? (
          <>
            <p className={c('text-[12px] text-[#7ea8c4]', 'text-sm font-medium text-foreground')}>{flight.droneSnapshot.alias}</p>
            <p className={c('text-[10px] text-[#8aa8c4] mt-0.5', 'text-xs text-muted-foreground mt-0.5')}>
              {flight.droneSnapshot.marca} {flight.droneSnapshot.modelo}
              {flight.droneSnapshot.numeroDeSerie && ` · S/N ${flight.droneSnapshot.numeroDeSerie}`}
            </p>
          </>
        ) : (
          <p className={c('text-[12px] text-[#5a7a9a]', 'text-sm text-muted-foreground')}>Sin aeronave registrada</p>
        )}
      </div>

      {flight.baterias?.length > 0 && (
        <div className={c('p-3 border border-[#16283a] bg-[#070b10] rounded', 'glass rounded-xl border border-white/10 p-3')}>
          <p className={c('text-[9px] tracking-[0.2em] text-[#5a7a9a] mb-2', 'text-xs text-muted-foreground mb-2')}>BATERÍAS USADAS</p>
          <div className="space-y-1.5">
            {flight.baterias.map((b) => (
              <div key={b.bateriaId} className="flex justify-between">
                <span className={c('text-[11px] text-[#7ea8c4]', 'text-sm text-foreground')}>{b.alias}</span>
                {b.numeroDeSerie && <span className={c('text-[11px] text-[#8aa8c4]', 'text-xs text-muted-foreground')}>S/N {b.numeroDeSerie}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {flight.contexto?.clima && (
        <div className={c('p-3 border border-[#16283a] bg-[#070b10] rounded', 'glass rounded-xl border border-white/10 p-3')}>
          <p className={c('text-[9px] tracking-[0.2em] text-[#5a7a9a] mb-1', 'text-xs text-muted-foreground mb-1')}>CLIMA EN START</p>
          <p className={c('text-[12px] text-[#7ea8c4]', 'text-sm text-foreground')}>
            {flight.contexto.clima.temp}°C · {flight.contexto.clima.viento} · {flight.contexto.clima.descripcion}
          </p>
        </div>
      )}

      {flight.contexto?.eacFiz && (
        <div className={c('p-3 border border-[#16283a] bg-[#070b10] rounded', 'glass rounded-xl border border-white/10 p-3')}>
          <p className={c('text-[9px] tracking-[0.2em] text-[#5a7a9a] mb-1', 'text-xs text-muted-foreground mb-1')}>EAC / FIZ EN START</p>
          <p className={`text-sm font-semibold ${flight.contexto.eacFiz.estado === 'sin_restricciones' ? 'text-green-500' :
            flight.contexto.eacFiz.estado === 'sin_datos' ? 'text-muted-foreground' :
              flight.contexto.eacFiz.estado === 'informativo' ? 'text-sky-500' :
                flight.contexto.eacFiz.estado === 'condicional' ? 'text-amber-500' :
                  'text-orange-500'
            }`}>
            {flight.contexto.eacFiz.estado === 'sin_restricciones' ? '✓ Sin restricciones' :
              flight.contexto.eacFiz.estado === 'sin_datos' ? '— Sin datos ENAIRE' :
                flight.contexto.eacFiz.estado === 'informativo' ? 'ℹ Zona informativa' :
                  flight.contexto.eacFiz.estado === 'condicional' ? '⚠ Zona condicional' :
                    `⚠ ${flight.contexto.eacFiz.estado.charAt(0).toUpperCase() + flight.contexto.eacFiz.estado.slice(1)}`}
          </p>
          {flight.contexto.eacFiz.zonas?.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {flight.contexto.eacFiz.zonas.map((z, i) => (
                <p key={i} className={c('text-[10px] text-[#8aa8c4]', 'text-xs text-muted-foreground')}>
                  · {z.nombre} ({z.label})
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {flight.contexto?.cmf && (
        <div className={c('p-3 border border-[#16283a] bg-[#070b10] rounded', 'glass rounded-xl border border-white/10 p-3')}>
          <p className={c('text-[9px] tracking-[0.2em] text-[#5a7a9a] mb-1', 'text-xs text-muted-foreground mb-1')}>CMF EN START</p>
          <p className={`text-sm font-semibold ${flight.contexto.cmf.estado === 'green' ? 'text-green-500' : flight.contexto.cmf.estado === 'amber' ? 'text-amber-500' : 'text-red-500'}`}>
            {flight.contexto.cmf.estado === 'green' ? '✓ Aprobado' : flight.contexto.cmf.estado === 'amber' ? '⚠ Con cautela' : '✗ No recomendado'}
          </p>
        </div>
      )}

      {flight.observaciones && (
        <div className={c('p-3 border border-[#16283a] bg-[#070b10] rounded', 'glass rounded-xl border border-white/10 p-3')}>
          <p className={c('text-[9px] tracking-[0.2em] text-[#5a7a9a] mb-1', 'text-xs text-muted-foreground mb-1')}>OBSERVACIONES</p>
          <p className={c('text-[12px] text-[#7ea8c4] leading-relaxed', 'text-sm text-foreground leading-relaxed')}>{flight.observaciones}</p>
        </div>
      )}

      <button onClick={onExport} disabled={exporting}
        className={c(
          'w-full py-3 border border-[#2a4258] text-[#8aa8c4] text-[11px] tracking-[0.2em] rounded hover:border-[#3e6585] hover:text-[#7eb8d4] transition-colors disabled:opacity-50',
          'w-full py-3 glass border border-white/10 text-muted-foreground text-sm rounded-xl hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50',
        )}>
        {exporting ? 'GENERANDO PDF···' : 'EXPORTAR PDF AESA (APÉNDICE M) ↗'}
      </button>
    </div>
  );
}