/**
 * PreflightHUD.jsx — BioKaizen Solutions / UPGES v1
 * Pantalla de pre-flight check estilo cockpit
 * Muestra el estado de cada ítem en tiempo real mientras se verifican
 */

// Helper de estilos — devuelve clase cockpit o clase tema según modo
const fo = (cockpitMode) => (cockpit, theme) => cockpitMode ? cockpit : theme;

const ITEM_CONFIG = {
  gps: { label: 'GPS SIGNAL', icon: '◎', required: true },
  drone: { label: 'AIRCRAFT', icon: '◈', required: true },
  batteries: { label: 'BATTERIES', icon: '▣', required: true },
  cmf: { label: 'CMF STATUS', icon: '⊕', required: false },
  clima: { label: 'WEATHER DATA', icon: '◇', required: false },
  checklist: { label: 'PRE-FLT CHECK', icon: '☰', required: true },
  eacFiz: { label: 'EAC / FIZ', icon: '⊗', required: false },
};

const STATUS_STYLE = {
  pending: { color: '#8aa8c4', symbol: '···', label: 'CHECKING' },
  ok: { color: '#00c896', symbol: '✓', label: 'GO' },
  warn: { color: '#f0a030', symbol: '⚠', label: 'CAUTION' },
  error: { color: '#ff4444', symbol: '✗', label: 'NO GO' },
  na: { color: '#5a7a9a', symbol: '—', label: 'N/A' },
};

export default function PreflightHUD({ status = {}, eacFizMeta = null, climaMeta = null, cmfMeta = null, batteriesMeta = null, onAck = null, onCancel = null, cockpitMode = true }) {
  const allDone = Object.values(status).every((v) => v && v !== 'pending');
  const hasBlocker = Object.entries(status).some(
    ([key, val]) => ITEM_CONFIG[key]?.required && val === 'error'
  );
  const c = fo(cockpitMode);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={[
        'w-full max-w-sm rounded-2xl p-4 flex flex-col gap-4 border',
        c('bg-[#0c1218] border-[#2a4258]', 'bg-card border-border'),
      ].join(' ')}>
        <div className="flex items-center justify-between">
          <div>
            <p className={c('text-[10px] tracking-[0.3em] text-[#8aa8c4] uppercase', 'text-[10px] tracking-[0.3em] text-muted-foreground uppercase')}>Validaciones</p>
            <p className={c('text-[15px] tracking-[0.2em] text-[#7eb8d4]', 'text-[15px] tracking-[0.2em] text-primary')}>SYSTEMS CHECK</p>
          </div>
          <div className={[
            'px-3 py-1 rounded text-[11px] tracking-[0.2em] border',
            !allDone
              ? c('border-[#2a4258] text-[#8aa8c4]', 'border-border text-muted-foreground')
              : hasBlocker
                ? 'border-[#ff4444]/40 text-[#ff4444] bg-[#ff4444]/5'
                : 'border-[#00c896]/40 text-[#00c896] bg-[#00c896]/5',
          ].join(' ')}>
            {!allDone ? 'SCANNING' : hasBlocker ? 'NO GO' : 'CLEAR TO FLY'}
          </div>
        </div>

        <div className={c('border-t border-[#2a4258]', 'border-t border-border')} />

        <div className="flex flex-col gap-3">
          {Object.entries(ITEM_CONFIG).map(([key, config]) => {
            const itemStatus = status[key] ?? 'pending';
            const style = STATUS_STYLE[itemStatus];

            return (
              <div
                key={key}
                className={c(
                  'flex items-center justify-between py-2 border-b border-[#16283a]',
                  'flex items-center justify-between py-2 border-b border-border',
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="text-[16px]" style={{ color: style.color }}>
                    {config.icon}
                  </span>
                  <div>
                    <p className="text-[12px] tracking-[0.15em]" style={{ color: style.color }}>
                      {config.label}
                    </p>
                    {!config.required && key !== 'eacFiz' && key !== 'clima' && key !== 'cmf' && (
                      <p className={c('text-[9px] tracking-[0.1em] text-[#5a7a9a]', 'text-[9px] tracking-[0.1em] text-muted-foreground')}>OPCIONAL</p>
                    )}
                    {key === 'eacFiz' && eacFizMeta && (
                      <p className={c('text-[9px] tracking-[0.1em] text-[#5a7a9a]', 'text-[9px] tracking-[0.1em] text-muted-foreground')}>
                        {eacFizMeta.fuente === 'gps' ? 'GPS · ' : eacFizMeta.fuente === 'preset' ? 'PRESET · ' : 'CACHÉ · '}
                        {eacFizMeta.nombre}
                      </p>
                    )}
                    {key === 'eacFiz' && !eacFizMeta && (
                      <p className={c('text-[9px] tracking-[0.1em] text-[#5a7a9a]', 'text-[9px] tracking-[0.1em] text-muted-foreground')}>OPCIONAL</p>
                    )}
                    {key === 'batteries' && batteriesMeta && (
                      <p className={c('text-[9px] tracking-[0.1em] text-[#5a7a9a]', 'text-[9px] tracking-[0.1em] text-muted-foreground')}>{batteriesMeta}</p>
                    )}
                    {key === 'batteries' && !batteriesMeta && (
                      <p className={c('text-[9px] tracking-[0.1em] text-[#5a7a9a]', 'text-[9px] tracking-[0.1em] text-muted-foreground')}>Sin baterías asignadas al dron</p>
                    )}
                    {key === 'clima' && climaMeta && (
                      <p className={c('text-[9px] tracking-[0.1em] text-[#5a7a9a]', 'text-[9px] tracking-[0.1em] text-muted-foreground')}>{climaMeta}</p>
                    )}
                    {key === 'clima' && !climaMeta && (
                      <p className={c('text-[9px] tracking-[0.1em] text-[#5a7a9a]', 'text-[9px] tracking-[0.1em] text-muted-foreground')}>OPCIONAL · Sin datos en caché</p>
                    )}
                    {key === 'cmf' && cmfMeta && (
                      <p className={c('text-[9px] tracking-[0.1em] text-[#5a7a9a]', 'text-[9px] tracking-[0.1em] text-muted-foreground')}>
                        {cmfMeta === 'green' ? 'Última evaluación: Aprobado' : cmfMeta === 'amber' ? 'Última evaluación: Con cautela' : 'Última evaluación: No recomendado'}
                      </p>
                    )}
                    {key === 'cmf' && !cmfMeta && (
                      <p className={c('text-[9px] tracking-[0.1em] text-[#5a7a9a]', 'text-[9px] tracking-[0.1em] text-muted-foreground')}>OPCIONAL · Sin evaluación reciente</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {itemStatus === 'pending' && (
                    <span className={c('w-4 h-4 rounded-full border border-[#8aa8c4] border-t-transparent animate-spin', 'w-4 h-4 rounded-full border border-muted-foreground border-t-transparent animate-spin')} />
                  )}
                  <span
                    className="text-[12px] tracking-[0.2em] font-semibold"
                    style={{ color: style.color }}
                  >
                    {itemStatus !== 'pending' ? `${style.symbol}  ${style.label}` : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <p className={c('text-[9px] tracking-[0.1em] text-[#2a3a4a] mt-auto text-center', 'text-[9px] tracking-[0.1em] text-muted-foreground/40 mt-auto text-center')}>
          PRE-FLIGHT CHECK NO SUSTITUYE LA RESPONSABILIDAD DEL PIC
        </p>

        {onAck && allDone && !hasBlocker && (
          <button
            onClick={onAck}
            className={[
              'relative mt-4 w-full py-4 rounded-full text-[15px] font-bold tracking-[0.25em] transition-all',
              'border-4 border-[#00c896] text-[#00c896] bg-[#00c896]/5',
              'hover:bg-[#00c896]/10 active:scale-95',
              'shadow-[0_0_40px_rgba(0,200,150,0.15)] hover:shadow-[0_0_60px_rgba(0,200,150,0.25)]',
            ].join(' ')}
          >
            START
          </button>
        )}
        {onCancel && (
          <button
            onClick={onCancel}
            className={c(
              'mt-2 w-full py-2 text-[11px] tracking-[0.2em] text-[#8aa8c4] hover:text-[#ff4444] transition-colors',
              'mt-2 w-full py-2 text-[11px] tracking-[0.2em] text-muted-foreground hover:text-destructive transition-colors',
            )}
          >
            CANCELAR
          </button>
        )}
      </div>
    </div>
  );
}