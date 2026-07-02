/**
 * StopFlightSheet.jsx — BioKaizen Solutions / UPGES v1
 * Bottom sheet que aparece al pulsar STOP
 * Permite completar datos esenciales antes de guardar el vuelo
 *
 * IMPORTANTE: Actividad y Entorno ahora se piden ANTES de START (en
 * StandbyScreen), así que aquí solo se muestran como confirmación de solo
 * lectura, no como selectores editables — evita pedirlos dos veces. Día/
 * Noche y VLOS/EVLOS/BVLOS siguen pidiéndose aquí, en STOP, sin cambios.
 *
 * Flujo baterías (Opción B aprobada):
 *   1. Usuario selecciona baterías usadas durante el vuelo (multi-select)
 *   2. numAterrizajes se autorrellena con baterias.length SOLO si el usuario
 *      no lo ha tocado manualmente todavía (no pisa una corrección suya)
 *   3. Las baterías candidatas se agrupan: primero las del dron en vuelo,
 *      luego el resto del inventario bajo "Otras baterías" (colapsado)
 */

import { useState, useEffect, useMemo } from 'react';
import { getDispositivosByTipo, getDispositivoDisplayName } from '@/lib/dispositivosDB';
import { FUNCION_PILOTO, CONDICION_HORARIA, CONDICION_VISUAL, getDefaultHoraria } from '../../db/flightModels';

// Helper de estilos — devuelve clase cockpit o clase tema según modo
const fo = (cockpitMode) => (cockpit, theme) => cockpitMode ? cockpit : theme;

function fmtElapsed(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

// Notas informativas — el 90% de pilotos amateur no conocen estos términos
const FUNCION_PILOTO_INFO = {
  PIC: 'Piloto al mando — responsable legal de la operación',
  SPIC: 'Piloto en prácticas — bajo supervisión de un instructor',
  Copiloto: 'Apoya al piloto al mando sin control directo de la aeronave',
  Instructor: 'Supervisa y evalúa a un piloto en formación',
};

const CONDICION_HORARIA_INFO = {
  D: 'Vuelo en condiciones de luz diurna',
  N: 'Vuelo nocturno — requiere luces anticolisión',
};

const CONDICION_VISUAL_INFO = {
  VLOS: 'Contacto visual directo y permanente con el dron',
  EVLOS: 'Visual extendido, con observador(es) en contacto con el piloto',
  BVLOS: 'Más allá del alcance visual — requiere autorización específica',
};

export default function StopFlightSheet({ draft, elapsed, onConfirm, onDiscard, onCancel, cockpitMode = true }) {
  const [form, setForm] = useState({
    funcionPiloto: draft?.funcionPiloto ?? FUNCION_PILOTO.PIC,
    numAterrizajes: draft?.numAterrizajes ?? 1,
    condicionHoraria: draft?.condicionesOp?.horaria ?? getDefaultHoraria(),
    condicionVisual: draft?.condicionesOp?.visual ?? CONDICION_VISUAL.VLOS,
    observaciones: draft?.observaciones ?? '',
  });

  // Selección de baterías — objetos completos de dispositivosDB.js, no solo IDs
  const [baterias, setBaterias] = useState([]);
  const [selectedBateriaIds, setSelectedBateriaIds] = useState(new Set());
  const [showOtrasBaterias, setShowOtrasBaterias] = useState(false);

  // El usuario tocó numAterrizajes manualmente → dejar de autorrellenar
  const [aterrizajesTocadoManualmente, setAterrizajesTocadoManualmente] = useState(false);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const c = fo(cockpitMode);

  // ── Cargar baterías del inventario ───────────────────────────────────
  useEffect(() => {
    getDispositivosByTipo('bateria').then(setBaterias);
  }, []);

  // Baterías del dron en vuelo vs. resto del inventario
  const { bateriasDelDrone, otrasBaterias } = useMemo(() => {
    const delDrone = baterias.filter((b) => b.droneId === draft?.droneId);
    const otras = baterias.filter((b) => b.droneId !== draft?.droneId);
    return { bateriasDelDrone: delDrone, otrasBaterias: otras };
  }, [baterias, draft?.droneId]);

  // ── Toggle selección de batería ──────────────────────────────────────
  const toggleBateria = (bateriaId) => {
    setSelectedBateriaIds((prev) => {
      const next = new Set(prev);
      if (next.has(bateriaId)) next.delete(bateriaId);
      else next.add(bateriaId);
      return next;
    });
  };

  // ── Prefill reactivo de numAterrizajes ───────────────────────────────
  useEffect(() => {
    if (aterrizajesTocadoManualmente) return;
    if (selectedBateriaIds.size === 0) return;
    set('numAterrizajes', selectedBateriaIds.size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBateriaIds.size, aterrizajesTocadoManualmente]);

  const handleAterrizajesChange = (newValue) => {
    setAterrizajesTocadoManualmente(true);
    set('numAterrizajes', Math.max(1, newValue));
  };

  // ── Confirmar ─────────────────────────────────────────────────────────
  const handleConfirm = () => {
    const bateriasSeleccionadas = baterias
      .filter((b) => selectedBateriaIds.has(b.id))
      .map((b) => ({
        bateriaId: b.id,
        alias: b.alias || `${b.marca} ${b.modelo}`,
        numeroDeSerie: b.numeroDeSerie ?? null,
        ciclosEnEsteVuelo: b.totalCargas ?? null,
      }));

    onConfirm({
      funcionPiloto: form.funcionPiloto,
      numAterrizajes: Number(form.numAterrizajes),
      condicionesOp: {
        horaria: form.condicionHoraria,
        visual: form.condicionVisual,
        // Entorno ya se eligió antes de START — se mantiene sin tocar.
        entorno: draft?.condicionesOp?.entorno ?? '',
      },
      observaciones: form.observaciones,
      baterias: bateriasSeleccionadas,
    });
  };

  return (
    /* Overlay */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      {/* Modal centrado */}
      <div className={[
        'w-full max-w-md rounded-2xl max-h-[85vh] overflow-y-auto border',
        c('bg-[#0c1218] border-[#2a4258]', 'bg-card border-border'),
      ].join(' ')}>

        <div className="px-4 pb-6">
          {/* Header */}
          <div className="flex items-center justify-between py-3 mb-2">
            <div>
              <p className={c('text-[10px] tracking-[0.2em] text-[#8aa8c4]', 'text-[10px] tracking-[0.2em] text-muted-foreground')}>FINALIZAR VUELO</p>
              <p className={c('text-[22px] tabular-nums text-[#d4e8f4] tracking-[0.05em]', 'text-[22px] tabular-nums text-foreground tracking-[0.05em]')}>
                {fmtElapsed(elapsed)}
              </p>
            </div>
            <button
              onClick={onCancel}
              className={c('text-[#8aa8c4] text-xl hover:text-[#7ea8c4] transition-colors', 'text-muted-foreground text-xl hover:text-foreground transition-colors')}
            >
              ✕
            </button>
          </div>

          {/* Divider */}
          <div className={c('border-t border-[#16283a] mb-4', 'border-t border-border mb-4')} />

          {/* Actividad + Entorno — confirmación de solo lectura, ya elegidos antes de START */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <ReadOnlyField label="ACTIVIDAD" value={draft?.actividad} cockpitMode={cockpitMode} />
            <ReadOnlyField label="ENTORNO" value={draft?.condicionesOp?.entorno} cockpitMode={cockpitMode} />
          </div>

          {/* ── Baterías usadas ──────────────────────────────────── */}
          <Field label="BATERÍAS USADAS" cockpitMode={cockpitMode}>
            {bateriasDelDrone.length === 0 && otrasBaterias.length === 0 ? (
              <p className={c('text-[11px] text-[#5a7a9a] py-2', 'text-[11px] text-muted-foreground py-2')}>
                No hay baterías registradas en Dispositivos
              </p>
            ) : (
              <>
                {bateriasDelDrone.length === 0 && (
                  <p className={c('text-[10px] text-[#5a7a9a] py-1', 'text-[10px] text-muted-foreground py-1')}>
                    Sin baterías asignadas a esta aeronave
                  </p>
                )}
                {bateriasDelDrone.map((b) => (
                  <BateriaChip
                    key={b.id}
                    bateria={b}
                    selected={selectedBateriaIds.has(b.id)}
                    onToggle={() => toggleBateria(b.id)}
                    cockpitMode={cockpitMode}
                  />
                ))}

                {otrasBaterias.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowOtrasBaterias((v) => !v)}
                      className={c('text-[10px] tracking-[0.15em] text-[#8aa8c4] hover:text-[#5a8aaa] mt-2 mb-1 transition-colors', 'text-[10px] text-muted-foreground hover:text-foreground mt-2 mb-1 transition-colors')}
                    >
                      {showOtrasBaterias ? '− OCULTAR' : '+ OTRAS BATERÍAS DEL INVENTARIO'}
                    </button>
                    {showOtrasBaterias && otrasBaterias.map((b) => (
                      <BateriaChip
                        key={b.id}
                        bateria={b}
                        selected={selectedBateriaIds.has(b.id)}
                        onToggle={() => toggleBateria(b.id)}
                        cockpitMode={cockpitMode}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </Field>

          {/* Función piloto — con nota informativa */}
          <Field label="FUNCIÓN PILOTO" cockpitMode={cockpitMode}>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {Object.values(FUNCION_PILOTO).map((f) => (
                <button
                  key={f}
                  onClick={() => set('funcionPiloto', f)}
                  className={[
                    'py-2 px-3 text-[11px] tracking-[0.15em] rounded border transition-colors',
                    form.funcionPiloto === f
                      ? c('border-[#7eb8d4] text-[#7eb8d4] bg-[#7eb8d4]/5', 'border-primary text-primary bg-primary/5')
                      : c('border-[#2a4258] text-[#8aa8c4] hover:border-[#3e6585]', 'border-border text-muted-foreground hover:border-primary/50'),
                  ].join(' ')}
                >
                  {f}
                </button>
              ))}
            </div>
            <p className={c('text-[10px] text-[#5a7a9a] leading-relaxed', 'text-[10px] text-muted-foreground leading-relaxed')}>
              {FUNCION_PILOTO_INFO[form.funcionPiloto]}
            </p>
          </Field>

          {/* Condiciones — Día/Noche y VLOS/EVLOS/BVLOS, con notas informativas */}
          <Field label="CONDICIONES" cockpitMode={cockpitMode}>
            <div className="flex gap-2 mb-1">
              {[CONDICION_HORARIA.DIA, CONDICION_HORARIA.NOCHE].map((v) => (
                <ToggleChip
                  key={v}
                  label={v === 'D' ? 'DÍA' : 'NOCHE'}
                  active={form.condicionHoraria === v}
                  onToggle={() => set('condicionHoraria', v)}
                  cockpitMode={cockpitMode}
                />
              ))}
            </div>
            <p className={c('text-[10px] text-[#5a7a9a] leading-relaxed mb-3', 'text-[10px] text-muted-foreground leading-relaxed mb-3')}>
              {CONDICION_HORARIA_INFO[form.condicionHoraria]}
            </p>

            <div className="flex gap-2 mb-1">
              {Object.values(CONDICION_VISUAL).map((v) => (
                <ToggleChip
                  key={v}
                  label={v}
                  active={form.condicionVisual === v}
                  onToggle={() => set('condicionVisual', v)}
                  cockpitMode={cockpitMode}
                />
              ))}
            </div>
            <p className={c('text-[10px] text-[#5a7a9a] leading-relaxed', 'text-[10px] text-muted-foreground leading-relaxed')}>
              {CONDICION_VISUAL_INFO[form.condicionVisual]}
            </p>
          </Field>

          {/* Aterrizajes — prefill reactivo desde baterías, editable manualmente */}
          <Field label="Nº ATERRIZAJES" cockpitMode={cockpitMode}>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleAterrizajesChange(form.numAterrizajes - 1)}
                className={c('w-10 h-10 rounded border border-[#2a4258] text-[#7ea8c4] text-xl hover:border-[#3e6585] transition-colors', 'w-10 h-10 rounded border border-border text-foreground text-xl hover:border-primary transition-colors')}
              >
                −
              </button>
              <span className={c('text-2xl tabular-nums text-[#d4e8f4] w-8 text-center', 'text-2xl tabular-nums text-foreground w-8 text-center')}>
                {form.numAterrizajes}
              </span>
              <button
                onClick={() => handleAterrizajesChange(form.numAterrizajes + 1)}
                className={c('w-10 h-10 rounded border border-[#2a4258] text-[#7ea8c4] text-xl hover:border-[#3e6585] transition-colors', 'w-10 h-10 rounded border border-border text-foreground text-xl hover:border-primary transition-colors')}
              >
                +
              </button>
              {!aterrizajesTocadoManualmente && selectedBateriaIds.size > 0 && (
                <span className={c('text-[9px] tracking-[0.1em] text-[#5a7a9a] ml-1', 'text-[9px] text-muted-foreground ml-1')}>
                  sugerido por baterías
                </span>
              )}
            </div>
            <p className={c('text-[10px] text-[#5a7a9a] leading-relaxed mt-2', 'text-[10px] text-muted-foreground leading-relaxed mt-2')}>
              Se registrarán como aterrizajes de {form.condicionHoraria === 'N' ? 'noche' : 'día'}, según la condición horaria seleccionada arriba (desglose exigido por Apéndice M AESA).
            </p>
          </Field>

          {/* Observaciones */}
          <Field label="OBSERVACIONES" cockpitMode={cockpitMode}>
            <textarea
              value={form.observaciones}
              onChange={(e) => set('observaciones', e.target.value)}
              rows={3}
              placeholder="Incidencias, notas del vuelo..."
              className={c(
                'w-full bg-[#070b10] border border-[#2a4258] text-[#7ea8c4] text-sm px-3 py-2.5 rounded tracking-wide resize-none placeholder-[#5a7a9a]',
                'w-full bg-background border border-border text-foreground text-sm px-3 py-2.5 rounded tracking-wide resize-none placeholder:text-muted-foreground',
              )}
            />
          </Field>

          {/* ── Acciones ────────────────────────────────────────── */}
          <div className="flex flex-col gap-2 mt-4">
            <button
              onClick={handleConfirm}
              className="w-full py-3.5 rounded text-[13px] tracking-[0.2em] font-semibold transition-all bg-[#00c896]/10 border border-[#00c896]/40 text-[#00c896] hover:bg-[#00c896]/15"
            >
              GUARDAR VUELO
            </button>
            <button
              onClick={onDiscard}
              className="w-full py-3.5 rounded text-[13px] tracking-[0.2em] font-semibold transition-all bg-[#ff4444]/10 border border-[#ff4444]/40 text-[#ff4444] hover:bg-[#ff4444]/15"
            >
              DESCARTAR VUELO
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, cockpitMode = true }) {
  const c = fo(cockpitMode);
  return (
    <div className="mb-4">
      <p className={c('text-[9px] tracking-[0.25em] text-[#8aa8c4] mb-2 uppercase', 'text-[9px] tracking-[0.25em] text-muted-foreground mb-2 uppercase')}>{label}</p>
      {children}
    </div>
  );
}

function ReadOnlyField({ label, value, cockpitMode = true }) {
  const c = fo(cockpitMode);
  return (
    <div>
      <p className={c('text-[9px] tracking-[0.25em] text-[#8aa8c4] mb-1.5 uppercase', 'text-[9px] tracking-[0.25em] text-muted-foreground mb-1.5 uppercase')}>{label}</p>
      <div className={c(
        'px-3 py-2 border border-[#2a4258] rounded text-[12px] text-[#7eb8d4] tracking-wider bg-[#070b10] truncate',
        'px-3 py-2 border border-border rounded text-[12px] text-primary tracking-wider bg-muted truncate',
      )}>
        {value || '—'}
      </div>
    </div>
  );
}

function ToggleChip({ label, active, onToggle, cockpitMode = true }) {
  const c = fo(cockpitMode);
  return (
    <button
      onClick={onToggle}
      className={[
        'px-3 py-1.5 text-[10px] tracking-[0.15em] rounded border transition-colors',
        active
          ? c('border-[#7eb8d4]/60 text-[#7eb8d4] bg-[#7eb8d4]/5', 'border-primary/60 text-primary bg-primary/5')
          : c('border-[#2a4258] text-[#8aa8c4] hover:border-[#3e6585]', 'border-border text-muted-foreground hover:border-primary/50'),
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function BateriaChip({ bateria, selected, onToggle, cockpitMode = true }) {
  const c = fo(cockpitMode);
  return (
    <button
      onClick={onToggle}
      className={[
        'w-full flex items-center justify-between px-3 py-2.5 mb-1.5 rounded border transition-colors text-left',
        selected
          ? 'border-[#00c896]/50 bg-[#00c896]/5 text-[#00c896]'
          : c('border-[#2a4258] text-[#5a8aaa] hover:border-[#3e6585]', 'border-border text-muted-foreground hover:border-primary/50'),
      ].join(' ')}
    >
      <div>
        <p className="text-[12px] tracking-wider">{getDispositivoDisplayName(bateria)}</p>
        {bateria.numeroDeSerie && (
          <p className={c('text-[9px] text-[#8aa8c4] tracking-wider mt-0.5', 'text-[9px] text-muted-foreground tracking-wider mt-0.5')}>{bateria.numeroDeSerie}</p>
        )}
      </div>
      {selected && <span>✓</span>}
    </button>
  );
}