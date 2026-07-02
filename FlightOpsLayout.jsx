/**
 * FlightOpsLayout.jsx — BioKaizen Solutions / UPGES v1
 * Shell principal de la sección Flight Ops
 *
 * cockpitMode: true  → estética HUD/cockpit original (paleta oscura fija)
 * cockpitMode: false → respeta el tema Dark/Light de la app (glass, pills, shadcn)
 *
 * El toggle se guarda en localStorage para persistir entre sesiones.
 * La prop cockpitMode se pasa a todos los hijos para que adapten sus estilos.
 */

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useFlightSession } from '../hooks/useFlightSession';
import FlightOpsDashboard from './dashboard/FlightOpsDashboard';
import FlightSessionPanel from './session/FlightSessionPanel';
import LogBook from './logbook/LogBook';

const TABS = [
  { id: 'session', label: 'SESIÓN', icon: '◉' },
  { id: 'dashboard', label: 'DASHBOARD', icon: '▦' },
  { id: 'logbook', label: 'LOG BOOK', icon: '≡' },
];

const LS_COCKPIT_KEY = 'upges_fo_cockpit_mode';

// Helper: devuelve clase cockpit o clase tema según modo
const fo = (cockpitMode) => (cockpit, theme) => cockpitMode ? cockpit : theme;

export default function FlightOpsLayout() {
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem('upges_fo_active_tab') || 'session'; } catch { return 'session'; }
  });

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    try { localStorage.setItem('upges_fo_active_tab', tab); } catch { }
  };
  const [cockpitMode, setCockpitMode] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_COCKPIT_KEY);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });

  const toggleCockpitMode = () => {
    setCockpitMode((prev) => {
      const next = !prev;
      try { localStorage.setItem(LS_COCKPIT_KEY, String(next)); } catch { }
      return next;
    });
  };

  const flightSession = useFlightSession({
    settings: {
      preflightLevel: 2,
      maxFlightDurationMin: 60,
      cmfMaxAgeMin: 60,
      climaMaxAgeMin: 60,
    },
    onFlightSaved: (flight) => {
      toast.success('Vuelo guardado correctamente', {
        description: `${flight.actividad || 'Sin actividad'} · ${flight.duracionMinutos ?? 0}min`,
      });
    },
  });

  const { isRecording, isAutoStopped } = flightSession;
  const c = fo(cockpitMode);

  // Auto-navegar a SESIÓN cuando el auto-stop se dispara
  useEffect(() => {
    if (isAutoStopped) handleTabChange('session');
  }, [isAutoStopped]);

  return (
    <div className={[
      'flex flex-col h-full select-none',
      c('bg-[#0a0e14] text-[#c8d8e8] font-mono', 'bg-background text-foreground font-sans'),
    ].join(' ')}>

      {/* ── HUD Header ───────────────────────────────────────────── */}
      <header className={[
        'flex items-center justify-between px-4 pt-3 pb-2 border-b',
        c('border-[#2a4258]', 'border-white/10'),
      ].join(' ')}>
        <div className="flex flex-col">
          <span className={c(
            'text-[10px] tracking-[0.25em] text-[#4a6a8a] uppercase',
            'text-xs text-muted-foreground uppercase',
          )}>
            BioKaizen Solutions
          </span>
          <span className={c(
            'text-[15px] tracking-[0.15em] font-semibold text-[#7eb8d4]',
            'text-base font-bold text-foreground',
          )}>
            {c('FLIGHT OPS', 'Flight Ops')}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Toggle cockpit / tema */}
          <button
            onClick={toggleCockpitMode}
            title={cockpitMode ? 'Cambiar a tema de la app' : 'Cambiar a modo cockpit'}
            className={c(
              'text-[9px] tracking-[0.15em] px-2 py-1 rounded border transition-colors border-[#2a4258] text-[#5a7a9a] hover:border-[#3e6585] hover:text-[#7eb8d4]',
              'text-xs px-2.5 py-1 rounded-lg border transition-colors glass border-white/10 text-muted-foreground hover:text-primary',
            )}
          >
            {cockpitMode ? '◑ TEMA' : '◑ COCKPIT'}
          </button>

          {/* Badge de estado */}
          {isRecording ? (
            <span className="flex items-center gap-1.5 text-[11px] tracking-widest text-[#ff4444]">
              <span className="w-2 h-2 rounded-full bg-[#ff4444] animate-pulse" />
              REC
            </span>
          ) : isAutoStopped ? (
            <span className="flex items-center gap-1.5 text-[11px] tracking-widest text-[#00c896]">
              <span className="w-2 h-2 rounded-full bg-[#00c896]" />
              GUARDADO
            </span>
          ) : (
            <span className={c(
              'text-[11px] tracking-widest text-[#8aa8c4]',
              'text-xs text-muted-foreground',
            )}>
              {c('STANDBY', 'Standby')}
            </span>
          )}
        </div>
      </header>

      {/* ── Tab bar ──────────────────────────────────────────────── */}
      {cockpitMode ? (
        /* Cockpit: underline style */
        <nav className="flex border-b border-[#2a4258] bg-[#070b10]">
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            const alertSession = tab.id === 'session' && (isRecording || isAutoStopped) && !active;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={[
                  'flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] tracking-[0.15em] transition-colors duration-150',
                  active
                    ? 'text-[#7eb8d4] border-b-2 border-[#7eb8d4] -mb-px bg-[#0a0e14]'
                    : 'text-[#8aa8c4] hover:text-[#5a8aaa]',
                  alertSession ? 'text-[#ff4444]' : '',
                ].join(' ')}
              >
                <span className="text-[16px] leading-none">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      ) : (
        /* Tema: pill style — igual que ProgresoTab */
        <nav className="flex gap-1 mx-4 mt-3 mb-1 glass rounded-xl p-1 border border-white/10">
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            const alertSession = tab.id === 'session' && (isRecording || isAutoStopped) && !active;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={[
                  'flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-semibold rounded-lg transition-all duration-200',
                  active
                    ? 'bg-primary text-primary-foreground shadow'
                    : alertSession
                      ? 'text-destructive hover:bg-destructive/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-primary/10',
                ].join(' ')}
              >
                <span className="text-base leading-none">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* ── Contenido de la tab activa ───────────────────────────── */}
      <main className="flex-1 overflow-y-auto overscroll-contain">
        {activeTab === 'session' && (
          <FlightSessionPanel flightSession={flightSession} cockpitMode={cockpitMode} />
        )}
        {activeTab === 'dashboard' && <FlightOpsDashboard cockpitMode={cockpitMode} />}
        {activeTab === 'logbook' && <LogBook cockpitMode={cockpitMode} />}
      </main>
    </div>
  );
}