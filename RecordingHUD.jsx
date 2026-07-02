/**
 * RecordingHUD.jsx — BioKaizen Solutions / UPGES v1
 * Vista principal durante la grabación del vuelo
 * Muestra: timer · datos del vuelo · botón STOP
 */

// Helper de estilos — devuelve clase cockpit o clase tema según modo
const fo = (cockpitMode) => (cockpit, theme) => cockpitMode ? cockpit : theme;

function formatElapsed(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export default function RecordingHUD({ elapsed = 0, draft = {}, onStopRequest, autoStopped = false, onAcknowledgeAutoStop, duracionMaxMin = 60, cockpitMode = true }) {
  const coords = draft?.coordenadas;
  const hasCoords = coords?.lat && coords?.lng;
  const clima = draft?.contexto?.clima;
  const droneAlias = draft?.droneSnapshot?.alias;
  const c = fo(cockpitMode);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={[
        'w-full max-w-sm rounded-2xl flex flex-col border',
        c('bg-[#0c1218] border-[#2a4258]', 'bg-card border-border'),
      ].join(' ')}>
        {/* ── Timer principal ──────────────────────────────────── */}
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <span className={c('text-[10px] tracking-[0.3em] text-[#8aa8c4]', 'text-[10px] tracking-[0.3em] text-muted-foreground')}>TIEMPO DE VUELO</span>
          <span
            className={c(
              'text-[52px] tabular-nums tracking-[0.05em] leading-none text-[#d4e8f4]',
              'text-[52px] tabular-nums tracking-[0.05em] leading-none text-foreground',
            )}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {formatElapsed(elapsed)}
          </span>
          <div className="flex items-center gap-2 mt-1">
            {autoStopped ? (
              <>
                <span className="w-2 h-2 rounded-full bg-[#00c896]" />
                <span className="text-[11px] tracking-[0.3em] text-[#00c896]">GUARDADO</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-[#ff4444] animate-pulse" />
                <span className="text-[11px] tracking-[0.3em] text-[#ff4444]">GRABANDO</span>
              </>
            )}
          </div>
        </div>

        {/* ── Datos contextuales (capturados en START) ─────────── */}
        <div className="px-4 grid grid-cols-2 gap-3 pb-4">
          <DataCell
            label="AERONAVE"
            value={droneAlias || 'No seleccionada'}
            icon="◈"
            ok={!!droneAlias}
            cockpitMode={cockpitMode}
          />
          <DataCell
            label="GPS"
            value={hasCoords
              ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
              : 'Sin señal'}
            icon="◎"
            ok={hasCoords}
            mono
            cockpitMode={cockpitMode}
          />
          <DataCell
            label="INICIO"
            value={draft?.horaInicio ?? '--:--'}
            icon="▷"
            ok={!!draft?.horaInicio}
            cockpitMode={cockpitMode}
          />
          <DataCell
            label="CLIMA"
            value={clima ? `${clima.temp}°C · ${clima.descripcion}` : 'Sin datos'}
            icon="◇"
            ok={!!clima}
            cockpitMode={cockpitMode}
          />
          <DataCell
            label="ACTIVIDAD"
            value={draft?.actividad || 'Sin definir'}
            icon="◉"
            ok={!!draft?.actividad}
            cockpitMode={cockpitMode}
          />
          <DataCell
            label="CONDICIONES"
            value={[
              draft?.condicionesOp?.horaria,
              draft?.condicionesOp?.visual,
            ].filter(Boolean).join(' · ') || '--'}
            icon="⊕"
            ok={true}
            cockpitMode={cockpitMode}
          />
        </div>

        {/* ── Botón STOP o mensaje auto-stop ──────────────────────────────── */}
        {autoStopped ? (
          <div className="flex flex-col items-center gap-3 pb-6 mt-auto px-4">
            <div className="flex items-center gap-2 px-4 py-2 border border-[#00c896]/30 bg-[#00c896]/5 rounded">
              <span className="text-[#00c896] text-sm">✓</span>
              <span className="text-[11px] tracking-[0.15em] text-[#00c896]">
                VUELO GUARDADO AUTOMÁTICAMENTE
              </span>
            </div>
            <p className={c('text-[10px] tracking-[0.1em] text-[#5a7a9a] text-center', 'text-[10px] text-muted-foreground text-center')}>
              El vuelo está disponible en el Log Book
            </p>
            <button
              onClick={onAcknowledgeAutoStop}
              className={[
                'w-full py-3 rounded text-[13px] tracking-[0.2em] font-semibold transition-all',
                'bg-[#00c896]/10 border border-[#00c896]/40 text-[#00c896]',
                'hover:bg-[#00c896]/15 active:scale-95',
              ].join(' ')}
            >
              ENTENDIDO
            </button>
          </div>
        ) : (
          <div className="flex justify-center pb-8 mt-auto">
            <button
              onClick={onStopRequest}
              className={[
                'w-32 h-32 rounded-full flex items-center justify-center',
                'text-[15px] font-bold tracking-[0.25em]',
                'border-4 border-[#ff4444] text-[#ff4444]',
                'bg-[#ff4444]/5',
                'shadow-[0_0_40px_rgba(255,68,68,0.1)]',
                'hover:shadow-[0_0_60px_rgba(255,68,68,0.2)]',
                'hover:scale-105 active:scale-95',
                'transition-all duration-150',
              ].join(' ')}
            >
              STOP
            </button>
          </div>
        )}

        {!autoStopped && (
          <p className="text-center text-[9px] tracking-[0.15em] text-[#F5B651] pb-3">
            AUTO-STOP · {duracionMaxMin}MIN MÁX
          </p>
        )}
      </div>
    </div>
  );
}

function DataCell({ label, value, icon, ok, mono = false, cockpitMode = true }) {
  const c = fo(cockpitMode);
  return (
    <div className={[
      'flex flex-col gap-1 p-3 rounded border',
      c('border-[#16283a] bg-[#070b10]', 'border-border bg-background'),
    ].join(' ')}>
      <div className="flex items-center gap-1.5">
        <span className={ok
          ? c('text-[#9ac4e4]', 'text-primary')
          : c('text-[#5a7a9a]', 'text-muted-foreground')
        }>{icon}</span>
        <span className={c('text-[9px] tracking-[0.2em] text-[#5a7a9a] uppercase', 'text-[9px] tracking-[0.2em] text-muted-foreground uppercase')}>{label}</span>
      </div>
      <span className={[
        'text-[12px] leading-tight',
        mono ? 'font-mono tabular-nums' : '',
        ok
          ? c('text-[#7ea8c4]', 'text-foreground')
          : c('text-[#5a7a9a]', 'text-muted-foreground'),
      ].join(' ')}>
        {value}
      </span>
    </div>
  );
}