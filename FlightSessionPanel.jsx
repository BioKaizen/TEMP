/**
 * FlightSessionPanel.jsx — BioKaizen Solutions / UPGES v1
 * Panel principal START/STOP — vista SESIÓN
 * El corazón de Flight Ops: botón grande + estado del vuelo en curso
 *
 * IMPORTANTE: useFlightSession ya NO se instancia aquí — se recibe como
 * prop desde FlightOpsLayout. Aeronave, Actividad y Entorno se piden ANTES
 * de START (las 3 obligatorias para habilitar el botón) para que al pulsar
 * STOP apenas haya que rellenar nada más. Si solo hay un dron registrado,
 * se autoselecciona. El cronómetro se congela al pulsar STOP (requestStop)
 * y se reanuda si se cancela el formulario (cancelStopRequest).
 *
 * Flujo START:
 *   1. Usuario pulsa CONTINUAR → start() → solo preflight/scanning
 *   2. Scanning completo → PreflightHUD muestra START + CANCELAR
 *   3. Usuario pulsa START → confirmStart() → arranca grabación real
 *   4. Usuario pulsa CANCELAR → cancelPreflight() → vuelve a StandbyScreen
 */

import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { getDispositivosByTipo, getDispositivoDisplayName } from '@/lib/dispositivosDB';
import { ACTIVIDAD, ENTORNO, AESA_COMPLIANCE_NOTES } from '../../db/flightModels';
import PreflightHUD from './PreflightHUD';
import RecordingHUD from './RecordingHUD';
import StopFlightSheet from './StopFlightSheet';

const ACTIVIDAD_DEFAULT = 'Recreativo';
const ENTORNO_DEFAULT = 'Espacio despejado';
const LAST_DRONE_KEY = 'UPGES_last_drone_id';
const DEFAULT_DURACION_MIN = 60;

// Helper de estilos — devuelve clase cockpit o clase tema según modo
const fo = (cockpitMode) => (cockpit, theme) => cockpitMode ? cockpit : theme;

// ─── ThemeDropdown — mismo patrón que CMF.jsx ────────────────────────────
function ThemeDropdown({ options, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full glass border border-white/10 rounded-xl px-4 py-2.5 flex items-center justify-between text-sm text-foreground hover:border-primary/50 transition"
      >
        <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-[200] bg-popover border border-border rounded-xl overflow-hidden shadow-xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-4 py-3 text-sm transition-colors ${value === o.value ? 'bg-primary/15 text-primary font-semibold' : 'text-foreground hover:bg-primary/10'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FlightSessionPanel({ flightSession, cockpitMode = true }) {
  const [showStopSheet, setShowStopSheet] = useState(false);
  const [selectedDrone, setSelectedDrone] = useState(null);
  const [selectedActividad, setSelectedActividad] = useState(ACTIVIDAD_DEFAULT);
  const [selectedEntorno, setSelectedEntorno] = useState(ENTORNO_DEFAULT);
  const [duracionEstimadaMin, setDuracionEstimadaMin] = useState(null);
  const [vueloNulo, setVueloNulo] = useState(false);

  const {
    state,
    isRecording,
    isPreflight,
    isPreflightDone,
    start,
    confirmStart,
    stop,
    requestStop,
    cancelStopRequest,
    discard,
    clearError,
    cancelPreflight,
    acknowledgeAutoStop,
    isAutoStopped,
  } = flightSession;

  // Cuando el auto-stop se dispara, cerrar StopFlightSheet y limpiar vueloNulo si estuviera activo
  useEffect(() => {
    if (isAutoStopped) {
      setShowStopSheet(false);
      setVueloNulo(false);
    }
  }, [isAutoStopped]);

  // ── Handlers ──────────────────────────────────────────────────

  const handleDroneSelect = (drone) => {
    setSelectedDrone(drone);
    clearError();
  };

  const handleStart = async () => {
    if (!selectedDrone || !selectedActividad || !selectedEntorno) return;
    try { localStorage.setItem(LAST_DRONE_KEY, selectedDrone.id); } catch { }
    await start({
      droneDispositivo: selectedDrone,
      actividad: selectedActividad,
      entorno: selectedEntorno,
      duracionMaxMin: duracionEstimadaMin ?? DEFAULT_DURACION_MIN,
    });
  };

  const handleVueloNulo = async () => {
    await discard();
    resetSelections();
    setVueloNulo(true);
    setTimeout(() => setVueloNulo(false), 3500);
  };

  const handleStopRequest = () => {
    // Vuelo de menos de 1 minuto — descarte automático sin formulario
    if (state.elapsed < 60) {
      handleVueloNulo();
      return;
    }
    requestStop();
    setShowStopSheet(true);
  };

  const resetSelections = () => {
    setSelectedDrone(null);
    setSelectedActividad(ACTIVIDAD_DEFAULT);
    setSelectedEntorno(ENTORNO_DEFAULT);
    setDuracionEstimadaMin(null);
  };

  const handleStopConfirm = async (extraData) => {
    setShowStopSheet(false);
    await stop({ extraData });
    resetSelections();
  };

  const handleStopCancel = () => {
    cancelStopRequest();
    setShowStopSheet(false);
  };

  const handleDiscard = async () => {
    setShowStopSheet(false);
    await discard();
    resetSelections();
  };

  // ── Render según phase ────────────────────────────────────────

  if (state.recovery && !isRecording) {
    return <RecoveryBanner recovery={state.recovery} cockpitMode={cockpitMode} />;
  }

  // Muestra PreflightHUD tanto durante el scanning como tras completar
  if (isPreflight) {
    return (
      <PreflightHUD
        status={state.preflightStatus}
        eacFizMeta={state.eacFizMeta ?? null}
        climaMeta={state.climaMeta ?? null}
        cmfMeta={state.cmfMeta ?? null}
        batteriesMeta={state.batteriesMeta ?? null}
        onAck={isPreflightDone ? confirmStart : null}
        onCancel={cancelPreflight}
        cockpitMode={cockpitMode}
      />
    );
  }

  const c = fo(cockpitMode);

  return (
    <div className={['flex flex-col gap-0 h-full', c('bg-[#0a0e14]', 'bg-background')].join(' ')}>
      {(isRecording || isAutoStopped) && (
        <RecordingHUD
          elapsed={state.elapsed}
          draft={state.draft}
          onStopRequest={handleStopRequest}
          autoStopped={isAutoStopped}
          onAcknowledgeAutoStop={acknowledgeAutoStop}
          duracionMaxMin={duracionEstimadaMin ?? DEFAULT_DURACION_MIN}
          cockpitMode={cockpitMode}
        />
      )}

      {!isRecording && !isAutoStopped && (
        <StandbyScreen
          selectedDrone={selectedDrone}
          onDroneSelect={handleDroneSelect}
          selectedActividad={selectedActividad}
          onActividadSelect={setSelectedActividad}
          selectedEntorno={selectedEntorno}
          onEntornoSelect={setSelectedEntorno}
          duracionEstimadaMin={duracionEstimadaMin}
          onDuracionChange={setDuracionEstimadaMin}
          onStart={handleStart}
          error={state.error}
          preflightStatus={state.preflightStatus}
          cockpitMode={cockpitMode}
        />
      )}

      {vueloNulo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className={[
            'px-8 py-6 rounded-2xl flex flex-col items-center gap-3 border',
            c('bg-[#0c1218] border-[#ff4444]/40', 'glass border-destructive/40'),
          ].join(' ')}>
            <span className="text-4xl text-[#ff4444]">✗</span>
            <p className={c('text-[16px] tracking-[0.3em] text-[#ff4444] font-bold', 'text-lg font-bold text-destructive')}>
              VUELO NULO
            </p>
            <p className={c('text-[11px] tracking-[0.1em] text-[#8aa8c4]', 'text-sm text-muted-foreground')}>
              Duración inferior a 1 minuto
            </p>
          </div>
        </div>
      )}

      {showStopSheet && (
        <StopFlightSheet
          draft={state.draft}
          elapsed={state.elapsed}
          onConfirm={handleStopConfirm}
          onDiscard={handleDiscard}
          onCancel={handleStopCancel}
          cockpitMode={cockpitMode}
        />
      )}
    </div>
  );
}

// ─── StandbyScreen ───────────────────────────────────────────────────────

function StandbyScreen({
  selectedDrone,
  onDroneSelect,
  selectedActividad,
  onActividadSelect,
  selectedEntorno,
  onEntornoSelect,
  duracionEstimadaMin,
  onDuracionChange,
  onStart,
  error,
  preflightStatus,
  cockpitMode,
}) {
  const [drones, setDrones] = useState([]);
  const c = fo(cockpitMode);

  useEffect(() => {
    getDispositivosByTipo('drone').then(setDrones);
    const handler = () => getDispositivosByTipo('drone').then(setDrones);
    window.addEventListener('upges:dispositivosUpdated', handler);
    return () => window.removeEventListener('upges:dispositivosUpdated', handler);
  }, []);

  // Autoselección: 1 dron → selecciona directo.
  // Varios drones → selecciona el último usado (localStorage), si existe en el inventario.
  useEffect(() => {
    if (drones.length === 0 || selectedDrone) return;
    if (drones.length === 1) {
      onDroneSelect(drones[0]);
      return;
    }
    try {
      const lastId = localStorage.getItem('UPGES_last_drone_id');
      if (lastId) {
        const last = drones.find((d) => d.id === lastId);
        if (last) onDroneSelect(last);
      }
    } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drones]);

  const requisitosCompletos = selectedDrone && selectedActividad && selectedEntorno;
  const continuarActivo = requisitosCompletos && error !== 'preflight_failed';

  // Opciones para ThemeDropdown (modo TEMA)
  const droneOptions = drones.map((d) => ({ value: d.id, label: getDispositivoDisplayName(d) }));
  const actividadOptions = ACTIVIDAD.map((a) => ({ value: a, label: a }));
  const entornoOptions = ENTORNO.map((e) => ({ value: e, label: e }));
  const duracionOptions = [
    { value: '15', label: '15 minutos' },
    { value: '30', label: '30 minutos' },
    { value: '45', label: '45 minutos' },
    { value: '60', label: '1 hora' },
    { value: '90', label: '1 hora 30 min' },
    { value: '120', label: '2 horas' },
  ];

  // ── Render COCKPIT ────────────────────────────────────────────
  if (cockpitMode) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-6 p-6">
        <div className="flex flex-col items-center gap-1">
          <span className="text-[10px] tracking-[0.3em] text-[#8aa8c4] uppercase">Estado</span>
          <span className="text-[13px] tracking-[0.2em] text-[#9ac4e4]">STANDBY</span>
        </div>

        <div className="w-full max-w-xs">
          <label className="block text-[10px] tracking-[0.2em] text-[#8aa8c4] mb-2 uppercase">Aeronave</label>
          <select
            value={selectedDrone?.id ?? ''}
            onChange={(e) => { const drone = drones.find((d) => d.id === e.target.value); onDroneSelect(drone ?? null); }}
            className={['w-full px-4 py-3 border rounded text-sm tracking-wider appearance-none',
              selectedDrone ? 'border-[#7eb8d4] text-[#7eb8d4] bg-[#0a1a2a]' : 'border-[#2a4258] text-[#8aa8c4] bg-[#070b10]',
            ].join(' ')}
          >
            <option value="">Seleccionar aeronave...</option>
            {drones.map((d) => <option key={d.id} value={d.id}>{getDispositivoDisplayName(d)}</option>)}
          </select>
          {drones.length === 0 && <p className="text-[10px] tracking-[0.1em] text-[#5a7a9a] mt-1 pl-1">No hay drones registrados en Dispositivos</p>}
          {selectedDrone?.numeroDeSerie && <p className="text-[10px] tracking-[0.15em] text-[#8aa8c4] mt-1 pl-1">S/N {selectedDrone.numeroDeSerie}</p>}
        </div>

        <div className="w-full max-w-xs">
          <label className="block text-[10px] tracking-[0.2em] text-[#8aa8c4] mb-2 uppercase">Actividad</label>
          <select value={selectedActividad} onChange={(e) => onActividadSelect(e.target.value)}
            className={['w-full px-4 py-3 border rounded text-sm tracking-wider appearance-none',
              selectedActividad ? 'border-[#7eb8d4] text-[#7eb8d4] bg-[#0a1a2a]' : 'border-[#2a4258] text-[#8aa8c4] bg-[#070b10]',
            ].join(' ')}
          >
            <option value="">Seleccionar actividad...</option>
            {ACTIVIDAD.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div className="w-full max-w-xs">
          <label className="block text-[10px] tracking-[0.2em] text-[#8aa8c4] mb-2 uppercase">Duración estimada (opcional)</label>
          <select value={duracionEstimadaMin ?? ''} onChange={(e) => onDuracionChange(e.target.value ? Number(e.target.value) : null)}
            className="w-full px-4 py-3 border border-[#2a4258] rounded text-sm tracking-wider appearance-none text-[#8aa8c4] bg-[#070b10]"
          >
            <option value="">Por defecto (1h máx.)</option>
            <option value="15">15 minutos</option>
            <option value="30">30 minutos</option>
            <option value="45">45 minutos</option>
            <option value="60">1 hora</option>
            <option value="90">1 hora 30 min</option>
            <option value="120">2 horas</option>
          </select>
        </div>

        <div className="w-full max-w-xs">
          <label className="block text-[10px] tracking-[0.2em] text-[#8aa8c4] mb-2 uppercase">Entorno</label>
          <select value={selectedEntorno} onChange={(e) => onEntornoSelect(e.target.value)}
            className={['w-full px-4 py-3 border rounded text-sm tracking-wider appearance-none',
              selectedEntorno ? 'border-[#7eb8d4] text-[#7eb8d4] bg-[#0a1a2a]' : 'border-[#2a4258] text-[#8aa8c4] bg-[#070b10]',
            ].join(' ')}
          >
            <option value="">Seleccionar entorno...</option>
            {ENTORNO.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        {error === 'preflight_failed' && (
          <div className="w-full max-w-xs">
            <ErrorPreflight preflightStatus={preflightStatus} />
          </div>
        )}

        <ContinuarButton requisitosCompletos={requisitosCompletos} continuarActivo={continuarActivo} onStart={onStart} cockpitMode />

        <p className="text-[10px] tracking-[0.15em] text-[#5a7a9a] text-center max-w-xs">
          {error === 'preflight_failed'
            ? 'Corrige el error y pulsa CONTINUAR de nuevo'
            : requisitosCompletos
              ? 'Se verificarán GPS, zona aérea, clima y CMF automáticamente'
              : 'Selecciona aeronave, actividad y entorno para continuar'}
        </p>

        {AESA_COMPLIANCE_NOTES.length > 0 && <AesaComplianceNote cockpitMode />}
      </div>
    );
  }

  // ── Render TEMA — mismo patrón que CMF.jsx ────────────────────
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 p-4 lg:p-6">
      <div className="w-full max-w-sm">
        <p className="text-xs text-muted-foreground uppercase text-center mb-1">Estado</p>
        <p className="text-sm font-medium text-foreground text-center mb-4">Standby</p>

        <div className="glass rounded-xl border border-white/10 p-4 space-y-4">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Aeronave *</label>
            {drones.length === 0
              ? <p className="text-xs text-muted-foreground italic px-1">No hay drones registrados en Dispositivos.</p>
              : <ThemeDropdown options={droneOptions} value={selectedDrone?.id ?? ''}
                onChange={(id) => { const drone = drones.find((d) => d.id === id); onDroneSelect(drone ?? null); }}
                placeholder="Selecciona una aeronave" />
            }
            {selectedDrone?.numeroDeSerie && <p className="text-xs text-muted-foreground px-1 mt-1">S/N {selectedDrone.numeroDeSerie}</p>}
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Actividad *</label>
            <ThemeDropdown options={actividadOptions} value={selectedActividad} onChange={onActividadSelect} placeholder="Selecciona actividad" />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Duración estimada <span className="text-muted-foreground/50 text-[10px]">(opcional)</span>
            </label>
            <ThemeDropdown
              options={duracionOptions}
              value={duracionEstimadaMin ? String(duracionEstimadaMin) : ''}
              onChange={(v) => onDuracionChange(v ? Number(v) : null)}
              placeholder="Por defecto (1h máx.)"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Entorno *</label>
            <ThemeDropdown options={entornoOptions} value={selectedEntorno} onChange={onEntornoSelect} placeholder="Selecciona entorno" />
          </div>
        </div>

        {error === 'preflight_failed' && (
          <div className="w-full max-w-xs mt-3">
            <ErrorPreflight preflightStatus={preflightStatus} />
          </div>
        )}

        <div className="flex flex-col items-center gap-3 mt-6">
          <ContinuarButton requisitosCompletos={requisitosCompletos} continuarActivo={continuarActivo} onStart={onStart} cockpitMode={false} />
          <p className="text-xs text-muted-foreground text-center">
            {error === 'preflight_failed'
              ? 'Corrige el error y pulsa CONTINUAR de nuevo'
              : requisitosCompletos
                ? 'Se verificarán GPS, zona aérea, clima y CMF automáticamente'
                : 'Selecciona aeronave, actividad y entorno para continuar'}
          </p>
        </div>

        {AESA_COMPLIANCE_NOTES.length > 0 && (
          <div className="mt-4"><AesaComplianceNote cockpitMode={false} /></div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-componentes compartidos ─────────────────────────────────────────

function ErrorPreflight({ preflightStatus }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border border-[#ff4444]/30 bg-[#ff4444]/5 rounded text-[#ff6666] text-xs tracking-wider max-w-xs w-full">
      <span>✗</span>
      <span>
        VALIDACIONES FALLIDAS —{' '}
        {preflightStatus?.gps === 'error' && preflightStatus?.drone === 'error'
          ? 'GPS sin señal y sin aeronave seleccionada'
          : preflightStatus?.gps === 'error' && preflightStatus?.checklist === 'error'
            ? 'GPS sin señal y checklist normativo incompleto'
            : preflightStatus?.drone === 'error' && preflightStatus?.checklist === 'error'
              ? 'Aeronave no seleccionada y checklist normativo incompleto'
              : preflightStatus?.gps === 'error'
                ? 'GPS sin señal (obligatorio en producción)'
                : preflightStatus?.drone === 'error'
                  ? 'Aeronave no seleccionada'
                  : preflightStatus?.checklist === 'error'
                    ? 'Checklist normativo AESA incompleto — revisa la sección ⚖️ en Checklist Pre-Vuelo'
                    : 'Comprobación no superada'}
      </span>
    </div>
  );
}

function ContinuarButton({ requisitosCompletos, continuarActivo, onStart, cockpitMode = true }) {
  const c = fo(cockpitMode);
  return (
    <button
      onClick={onStart}
      disabled={!requisitosCompletos}
      className={[
        'w-full max-w-xs py-3.5 rounded-xl text-sm font-semibold tracking-[0.15em] transition-all active:scale-[0.98]',
        continuarActivo
          ? 'bg-[#00c896]/10 border border-[#00c896]/40 text-[#00c896] hover:bg-[#00c896]/15'
          : c(
            'border border-[#2a4258] text-[#5a7a9a] bg-transparent cursor-not-allowed',
            'border border-border text-muted-foreground bg-transparent cursor-not-allowed',
          ),
      ].join(' ')}
    >
      CONTINUAR
    </button>
  );
}

function AesaComplianceNote({ cockpitMode = true }) {
  const [open, setOpen] = useState(false);
  const c = fo(cockpitMode);
  return (
    <div className={c(
      'w-full max-w-xs border border-[#f0a030]/30 bg-[#f0a030]/5 rounded',
      'w-full glass rounded-xl border border-amber-500/30 bg-amber-500/5',
    )}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-left">
        <span className="text-[9px] tracking-[0.1em] text-[#f0a030]">⚠ AVISO DE CUMPLIMIENTO (APÉNDICE M)</span>
        <span className="text-[#f0a030] text-xs">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="px-3 pb-2 space-y-1">
          {AESA_COMPLIANCE_NOTES.map((note) => (
            <li key={note} className="text-[9px] text-[#d4a050] leading-relaxed">• {note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── RecoveryBanner ──────────────────────────────────────────────────────

function RecoveryBanner({ recovery, cockpitMode }) {
  const c = fo(cockpitMode);
  return (
    <div className="m-4 p-4 border border-[#f0a030]/30 bg-[#f0a030]/5 rounded">
      <p className="text-[#f0a030] text-xs tracking-wider mb-1">⚠ SESIÓN RECUPERADA</p>
      <p className={c('text-[#8aa8c4] text-[11px]', 'text-sm text-muted-foreground')}>
        Se detectó un vuelo interrumpido.{' '}
        {recovery.mode === 'full' ? 'Datos recuperados.' : 'Datos parcialmente recuperados.'}
      </p>
    </div>
  );
}