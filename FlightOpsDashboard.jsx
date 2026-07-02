/**
 * FlightOpsDashboard.jsx — BioKaizen Solutions / UPGES v1
 * Dashboard de estadísticas Flight Ops — Fase 1 (placeholder)
 * Implementación completa en Fase 3
 */

import { useState, useEffect } from 'react';
import { getAllFlights, EVENT_FLIGHTS_UPDATED } from '../../db/flightOpsDB';
import { formatDuracion } from '../../db/flightModels';

// Helper de estilos — devuelve clase cockpit o clase tema según modo
const fo = (cockpitMode) => (cockpit, theme) => cockpitMode ? cockpit : theme;

export default function FlightOpsDashboard({ cockpitMode = true }) {
  const [stats, setStats] = useState(null);
  const c = fo(cockpitMode);

  const loadStats = async () => {
    const flights = await getAllFlights();
    const totalMin = flights.reduce((a, f) => a + (f.duracionMinutos ?? 0), 0);
    const thisMonth = flights.filter((f) => {
      const d = new Date(f.fecha);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const byActividad = flights.reduce((acc, f) => {
      const key = f.actividad || 'Sin clasificar';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    setStats({
      totalFlights: flights.length,
      totalMinutes: totalMin,
      monthFlights: thisMonth.length,
      monthMinutes: thisMonth.reduce((a, f) => a + (f.duracionMinutos ?? 0), 0),
      byActividad: Object.entries(byActividad).sort((a, b) => b[1] - a[1]).slice(0, 5),
    });
  };

  useEffect(() => {
    loadStats();
    window.addEventListener(EVENT_FLIGHTS_UPDATED, loadStats);
    return () => window.removeEventListener(EVENT_FLIGHTS_UPDATED, loadStats);
  }, []);

  if (!stats) {
    return (
      <div className={c('flex items-center justify-center h-40 text-[#5a7a9a] text-xs tracking-widest', 'flex items-center justify-center h-40 text-muted-foreground text-xs')}>
        CALCULANDO...
      </div>
    );
  }

return (
    <div className={c('p-4 space-y-4', 'p-4 lg:p-6 space-y-4 max-w-4xl mx-auto')}>
      <p className={c('text-[10px] tracking-[0.3em] text-[#8aa8c4]', 'text-xs font-semibold text-muted-foreground uppercase tracking-widest')}>ESTADÍSTICAS</p>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="VUELOS TOTALES" value={stats.totalFlights} unit="vuelos" cockpitMode={cockpitMode} />
        <MetricCard label="HORAS TOTALES" value={formatDuracion(stats.totalMinutes)} unit="" cockpitMode={cockpitMode} />
        <MetricCard label="ESTE MES" value={stats.monthFlights} unit="vuelos" cockpitMode={cockpitMode} />
        <MetricCard label="HRS MES" value={formatDuracion(stats.monthMinutes)} unit="" cockpitMode={cockpitMode} />
      </div>

      {stats.byActividad.length > 0 && (
        <div>
          <p className={c('text-[9px] tracking-[0.2em] text-[#5a7a9a] mb-2', 'text-[9px] text-muted-foreground mb-2')}>TOP ACTIVIDADES</p>
          {stats.byActividad.map(([actividad, count]) => (
            <div key={actividad} className={c('flex justify-between items-center py-1.5 border-b border-[#142436]', 'flex justify-between items-center py-1.5 border-b border-white/10')}>
              <span className={c('text-[11px] text-[#5a8aaa] tracking-wide truncate', 'text-[11px] text-foreground tracking-wide truncate')}>{actividad}</span>
              <span className={c('text-[11px] text-[#8aa8c4] tabular-nums ml-2', 'text-[11px] text-muted-foreground tabular-nums ml-2')}>{count}</span>
            </div>
          ))}
        </div>
      )}

      {stats.totalFlights === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <span className={c('text-4xl text-[#2a4258]', 'text-4xl text-muted-foreground/30')}>▦</span>
          <p className={c('text-[10px] tracking-[0.2em] text-[#5a7a9a]', 'text-[10px] text-muted-foreground')}>SIN DATOS TODAVÍA</p>
          <p className={c('text-[10px] text-[#3a5a7a]', 'text-[10px] text-muted-foreground/60')}>Registra vuelos para ver estadísticas</p>
        </div>
      )}

      <p className={c('text-[9px] tracking-[0.1em] text-[#3a5a7a] text-center pt-2', 'text-[9px] text-muted-foreground/50 text-center pt-2')}>
        ESTADÍSTICAS AVANZADAS DISPONIBLES EN FASE 3
      </p>
    </div>
  );
}

function MetricCard({ label, value, unit, cockpitMode = true }) {
  const c = fo(cockpitMode);
  return (
    <div className={c('p-4 border border-[#16283a] bg-[#070b10] rounded flex flex-col gap-1', 'glass rounded-xl border border-white/10 p-4 flex flex-col gap-1')}>
      <span className={c('text-[9px] tracking-[0.2em] text-[#5a7a9a]', 'text-[9px] text-muted-foreground')}>{label}</span>
      <span className={c('text-[22px] tabular-nums text-[#7ea8c4] leading-none font-semibold', 'text-[22px] tabular-nums text-primary leading-none font-semibold')}>{value}</span>
      {unit && <span className={c('text-[9px] text-[#5a7a9a]', 'text-[9px] text-muted-foreground')}>{unit}</span>}
    </div>
  );
}