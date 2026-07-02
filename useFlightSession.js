/**
 * useFlightSession.js — BioKaizen Solutions / UPGES v1
 *
 * Hook central del motor START/STOP de Flight Ops.
 * Orquesta: GPS · Clima · CMF · EAC/FIZ · Checklist → persistencia → grabación activa
 *
 * IMPORTANTE:
 *   - start() recibe el OBJETO COMPLETO del dron (de dispositivosDB.js) y la
 *     actividad (ahora se piden ambos ANTES de pulsar START).
 *   - start() SOLO ejecuta el preflight check. La grabación NO empieza hasta
 *     que el usuario pulsa START en el PreflightHUD → llama a confirmStart().
 *   - Las baterías NO se piden en start() — se rellenan en stop() (Opción B
 *     aprobada), porque el piloto confirma qué baterías usó al finalizar.
 *   - El cronómetro se CONGELA al pulsar STOP (requestStop), no al confirmar
 *     el formulario. horaFin se calcula con el instante real de la pulsación
 *     de STOP, no con el momento en que se rellena el sheet.
 *
 * Fases del hook:
 *   'idle'           → en espera
 *   'preflight'      → scanning en curso
 *   'preflight_done' → scanning completado, esperando confirmación del usuario
 *   'recording'      → grabación activa
 *   'stopping'       → STOP pulsado, procesando
 *   'saving'         → guardando en DB
 *   'autoStopped'    → parado automáticamente
 *
 * Refs internas (no son state — evitan stale closures en timers/callbacks):
 *   draftRef             → draft actual del vuelo en curso
 *   pendingStopAtRef     → instante congelado al pulsar STOP
 *   autoStopAtRef        → ISO string del momento de auto-stop programado
 *   stopFnRef            → versión actual de stop() para el setTimeout de auto-stop
 *   cancelledRef         → señal de cancelación durante el preflight
 *   preflightDataRef     → datos capturados durante preflight (GPS, clima, CMF, EAC/FIZ)
 *   pendingStartParamsRef → parámetros de start() para usar en confirmStart()
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createFlight,
  createActiveSession,
  createDroneSnapshot,
  toTimeString,
  toUTCTimeString,
  calcDuracionMinutos,
  CONDICION_VISUAL,
  getDefaultHoraria,
} from '../db/flightModels';
import {
  persistRecordingStart,
  updateRecordingDraft,
  clearRecordingState,
  checkRecordingState,
} from '../db/sessionPersistence';
import { saveFlight } from '../db/flightOpsDB';
import { isNormativaChecklistDone } from '@/lib/checklistStorage';
import { getDispositivosByTipo, getNivelCargaActual } from '@/lib/dispositivosDB';
import { getCachedLayer, setCachedLayer, getEnaireUserLocation } from '@/lib/enaireDB';
import { getZonesAtPoint } from '@/lib/enaireZones';
import { fetchLayerGeoJSON, ENAIRE_LAYERS } from '@/lib/enaireAPI';
import { getSettings } from '@/lib/storage';
import { App } from '@capacitor/app';
import { toast } from 'sonner';

// ─── Estado inicial del hook ──────────────────────────────────────────────

const INITIAL_STATE = {
  phase: 'idle',
  draft: null,
  session: null,
  elapsed: 0,
  pendingStopAt: null,
  error: null,
  recovery: null,
  preflightStatus: {
    gps: null,
    drone: null,
    batteries: null,
    cmf: null,
    clima: null,
    checklist: null,
    eacFiz: null,
  },
  eacFizMeta: null,
  climaMeta: null,
  cmfMeta: null,
  batteriesMeta: null,
};

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useFlightSession({ settings = {}, onFlightSaved } = {}) {
  const [state, setState] = useState(INITIAL_STATE);

  // ── Refs — fuente de verdad para timers y callbacks ──────────────────
  const timerRef = useRef(null);
  const autoStopRef = useRef(null);
  const cancelledRef = useRef(false);
  const draftRef = useRef(null);
  const pendingStopAtRef = useRef(null);
  const autoStopAtRef = useRef(null);
  const stopFnRef = useRef(null);
  const preflightDataRef = useRef(null); // datos capturados en preflight para confirmStart()
  const pendingStartParamsRef = useRef(null); // params de start() para confirmStart()

  const maxDurationMin = settings.maxFlightDurationMin ?? 60;

  // ── Arranque: recovery + listener de vuelta a primer plano ────────────
  useEffect(() => {
    (async () => {
      const recovery = await checkRecordingState();
      if (recovery.isRecording) {
        if (recovery.session?.draft) draftRef.current = recovery.session.draft;
        if (recovery.session?.autoStopAt) autoStopAtRef.current = recovery.session.autoStopAt;

        setState((s) => ({
          ...s,
          phase: 'recording',
          draft: recovery.session?.draft ?? null,
          session: recovery.session ?? null,
          recovery: {
            mode: recovery.recoveryMode,
            flightId: recovery.flightId,
            startedAt: recovery.startedAt,
          },
        }));
        toast.warning('Vuelo en curso', {
          description: 'Se ha recuperado una grabación activa. Ve a Flight Ops para gestionarla.',
          duration: 8000,
        });
        _startTimer(recovery.startedAt);
        _scheduleAutoStop(recovery.session?.autoStopAt);
      }
    })();

    const listenerPromise = App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      const autoStopAt = autoStopAtRef.current;
      if (autoStopAt && new Date() > new Date(autoStopAt)) {
        clearTimeout(autoStopRef.current);
        stopFnRef.current?.({ autoStopped: true });
      }
    });

    return () => {
      clearInterval(timerRef.current);
      clearTimeout(autoStopRef.current);
      listenerPromise.then((handle) => handle.remove()).catch(() => { });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Timer de tiempo transcurrido ─────────────────────────────────────
  function _startTimer(startedAt) {
    const startTs = startedAt ? new Date(startedAt).getTime() : Date.now();
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTs) / 1000);
      setState((s) => ({ ...s, elapsed }));
    }, 1000);
  }

  // ── Auto-stop por timeout ────────────────────────────────────────────
  function _scheduleAutoStop(autoStopAt) {
    if (!autoStopAt) return;
    const delay = new Date(autoStopAt).getTime() - Date.now();
    if (delay <= 0) {
      stopFnRef.current?.({ autoStopped: true });
      return;
    }
    clearTimeout(autoStopRef.current);
    autoStopRef.current = setTimeout(() => {
      stopFnRef.current?.({ autoStopped: true });
    }, delay);
  }

  // ── PRE-FLIGHT CHECK ─────────────────────────────────────────────────
  // Ejecuta todas las validaciones Y captura los datos contextuales (clima, CMF, EAC/FIZ)
  // que se guardarán en preflightDataRef para uso posterior en confirmStart().
  const runPreflightCheck = useCallback(async (droneDispositivo) => {
    setState((s) => ({ ...s, phase: 'preflight', preflightStatus: INITIAL_STATE.preflightStatus, eacFizMeta: null, climaMeta: null, cmfMeta: null, batteriesMeta: null }));

    const status = {
      gps: 'pending',
      drone: 'pending',
      batteries: 'pending',
      cmf: 'pending',
      clima: 'pending',
      checklist: 'pending',
      eacFiz: 'pending',
    };

    const updateStatus = (key, val) =>
      setState((s) => ({ ...s, preflightStatus: { ...s.preflightStatus, [key]: val } }));

    // ── Nivel 1 — siempre obligatorio ──────────────────────────────────
    const gpsResult = await _checkGPS();
    const gpsRequired = !import.meta.env.DEV;
    status.gps = gpsResult.ok ? 'ok' : (gpsRequired ? 'error' : 'warn');
    updateStatus('gps', status.gps);

    if (cancelledRef.current) return { passed: false, status, gpsCoords: null };

    status.drone = droneDispositivo ? 'ok' : 'error';
    updateStatus('drone', status.drone);

    // Baterías del dron — bloqueante si alguna < 30% (requisito Categoría Abierta AESA)
    const batteriesResult = await _checkBatteries(droneDispositivo);
    status.batteries = batteriesResult.status;
    updateStatus('batteries', status.batteries);

    if (cancelledRef.current) return { passed: false, status, gpsCoords: null };

    const checklistDone = _isChecklistDone();
    status.checklist = checklistDone ? 'ok' : 'error';
    updateStatus('checklist', status.checklist);

    // EAC/FIZ — usa GPS real o preset de Ajustes como fallback ────────
    let eacFizValue = null;
    if (cancelledRef.current) return { passed: false, status, gpsCoords: null };

    const eacFizCoords = gpsResult.coords
      ? { ...gpsResult.coords, fuente: 'gps', nombre: null }
      : _getPresetCoords();
    if (eacFizCoords) {
      eacFizValue = await _fetchEACFIZ(eacFizCoords);
      if (!eacFizValue || eacFizValue.estado === 'sin_datos') {
        status.eacFiz = 'na';
      } else if (eacFizValue.estado === 'sin_restricciones' || eacFizValue.estado === 'informativo') {
        status.eacFiz = 'ok';
      } else if (eacFizValue.estado === 'prohibido' || eacFizValue.estado === 'restringido') {
        status.eacFiz = 'warn';
      } else {
        status.eacFiz = 'ok';
      }
    } else {
      status.eacFiz = 'na';
    }
    updateStatus('eacFiz', status.eacFiz);

    const level1Passed =
      status.gps !== 'error' &&
      status.drone === 'ok' &&
      status.batteries !== 'error' &&
      status.checklist === 'ok';

    // ── Nivel 2 — CMF y clima (no bloqueantes) + fetch real de datos ───
    const checkLevel2 = settings.preflightLevel >= 2;
    let climaValue = null;
    let cmfValue = null;

    if (cancelledRef.current) return { passed: false, status, gpsCoords: null };

    const [climaFetch, cmfFetch] = await Promise.allSettled([
      _fetchClima(),
      _fetchCMF(),
    ]);
    climaValue = climaFetch.status === 'fulfilled' ? climaFetch.value : null;
    cmfValue = cmfFetch.status === 'fulfilled' ? cmfFetch.value : null;

    if (checkLevel2) {
      const cmfAge = _getCMFAge();
      status.cmf = cmfAge !== null && cmfAge < (settings.cmfMaxAgeMin ?? 60) ? 'ok' : 'warn';
      updateStatus('cmf', status.cmf);

      const climaAge = _getClimaAge();
      status.clima = climaAge !== null && climaAge < (settings.climaMaxAgeMin ?? 60) ? 'ok' : 'warn';
      updateStatus('clima', status.clima);
    } else {
      ['cmf', 'clima'].forEach((k) => { status[k] = 'na'; updateStatus(k, 'na'); });
    }

    const level2Passed =
      !checkLevel2 ||
      [status.cmf, status.clima].every((v) => v === 'ok' || v === 'warn' || v === 'na');

    const passed = level1Passed && level2Passed;

    // ── Almacenar datos capturados para confirmStart() ──────────────────
    preflightDataRef.current = {
      gpsCoords: gpsResult.coords,
      climaData: climaValue,
      cmfData: cmfValue,
      eacFizData: eacFizValue,
    };

    // Exponer coordsFuente en el state para que PreflightHUD pueda mostrarlo
    setState((s) => ({
      ...s,
      batteriesMeta: batteriesResult.detail,
      eacFizMeta: eacFizValue
        ? { fuente: eacFizValue.coordsFuente, nombre: eacFizValue.coordsNombre }
        : null,
      climaMeta: climaValue
        ? `${climaValue.temp}°C · ${climaValue.viento} · ${climaValue.descripcion}`
        : null,
      cmfMeta: cmfValue
        ? cmfValue.estado
        : null,
    }));

    return { passed, status, gpsCoords: gpsResult.coords };
  }, [settings]);

  // ── START — solo preflight, no arranca grabación ──────────────────────
  const start = useCallback(async ({
    droneDispositivo,
    actividad,
    entorno,
    duracionMaxMin,
    skipPreflight = false,
  } = {}) => {
    setState((s) => ({ ...s, error: null }));
    cancelledRef.current = false;

    // Almacenar params para confirmStart()
    pendingStartParamsRef.current = { droneDispositivo, actividad, entorno, duracionMaxMin };

    try {
      if (!skipPreflight) {
        const check = await runPreflightCheck(droneDispositivo);

        if (cancelledRef.current) return { success: false, reason: 'cancelled' };

        // Siempre ir a preflight_done — el usuario debe ver los resultados
        // aunque haya fallos. PreflightHUD oculta START si hay bloqueantes.
        setState((s) => ({ ...s, phase: 'preflight_done' }));
        if (!check.passed) {
          return { success: false, reason: 'preflight_failed' };
        }
        return { success: true, reason: 'awaiting_confirmation' };

      } else {
        // skipPreflight: ir directo a confirmStart (uso interno/tests)
        await confirmStart();
        return { success: true };
      }
    } catch (error) {
      console.error('[useFlightSession] start error:', error);
      setState((s) => ({ ...s, phase: 'idle', error: error.message }));
      return { success: false, reason: error.message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runPreflightCheck, confirmStart, settings]);

  // ── CONFIRM START — arranca la grabación tras confirmación del usuario ─
  const confirmStart = useCallback(async () => {
    if (cancelledRef.current) return { success: false, reason: 'cancelled' };

    const { droneDispositivo, actividad, entorno, duracionMaxMin } =
      pendingStartParamsRef.current ?? {};
    const { gpsCoords, climaData, cmfData, eacFizData } =
      preflightDataRef.current ?? {};

    try {
      const now = new Date();
      const duracion = duracionMaxMin ?? maxDurationMin;
      const autoStopAt = new Date(now.getTime() + duracion * 60 * 1000).toISOString();

      const draft = createFlight({
        horaInicio: toTimeString(now),
        horaInicioUTC: toUTCTimeString(now),
        actividad: actividad ?? '',
        droneId: droneDispositivo?.id ?? null,
        droneSnapshot: createDroneSnapshot(droneDispositivo),
        condicionesOp: {
          horaria: getDefaultHoraria(),
          visual: CONDICION_VISUAL.VLOS,
          entorno: entorno ?? '',
        },
        coordenadas: {
          lat: gpsCoords?.lat ?? null,
          lng: gpsCoords?.lng ?? null,
          altitud: gpsCoords?.altitude ?? null,
          precision: gpsCoords?.accuracy ?? null,
          fuente: gpsCoords ? 'gps' : 'manual',
        },
        contexto: {
          clima: climaData ?? null,
          cmf: cmfData ?? null,
          eacFiz: eacFizData ?? null,
          checklistId: null,
          checklistAprobado: null,
        },
      });

      // Asignar refs ANTES de cualquier await posterior
      draftRef.current = draft;
      autoStopAtRef.current = autoStopAt;

      const session = createActiveSession(draft);
      session.autoStopAt = autoStopAt;

      await persistRecordingStart(session);
      _startForegroundNotification(draft);

      setState((prev) => ({
        ...INITIAL_STATE,
        phase: 'recording',
        draft,
        session,
        elapsed: 0,
        preflightStatus: prev.preflightStatus,
      }));

      _startTimer(session.startedAt);
      _scheduleAutoStop(autoStopAt);

      // Limpiar refs temporales
      pendingStartParamsRef.current = null;
      preflightDataRef.current = null;

      return { success: true, flightId: draft.id };
    } catch (error) {
      console.error('[useFlightSession] confirmStart error:', error);
      setState((s) => ({ ...s, phase: 'idle', error: error.message }));
      return { success: false, reason: error.message };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxDurationMin, settings]);

  // ── REQUEST STOP ─────────────────────────────────────────────────────
  const requestStop = useCallback(() => {
    clearInterval(timerRef.current);
    const frozenAt = new Date().toISOString();
    pendingStopAtRef.current = frozenAt;
    setState((s) => ({ ...s, pendingStopAt: frozenAt }));
  }, []);

  const cancelStopRequest = useCallback(() => {
    pendingStopAtRef.current = null;
    setState((s) => {
      if (s.session?.startedAt) _startTimer(s.session.startedAt);
      return { ...s, pendingStopAt: null };
    });
  }, []);

  // ── STOP ─────────────────────────────────────────────────────────────
  const stop = useCallback(async ({ autoStopped = false, extraData = {} } = {}) => {
    clearInterval(timerRef.current);
    clearTimeout(autoStopRef.current);

    setState((s) => ({ ...s, phase: 'stopping' }));

    try {
      const currentDraft = draftRef.current ?? {};
      const horaFinDate = pendingStopAtRef.current
        ? new Date(pendingStopAtRef.current)
        : new Date();

      const horaFin = toTimeString(horaFinDate);
      const horaFinUTC = toUTCTimeString(horaFinDate);
      const duracionMinutos = calcDuracionMinutos(currentDraft.horaInicio, horaFin);

      const mergedCondiciones = extraData.condicionesOp ?? currentDraft.condicionesOp;
      const numAterrizajesFinal = extraData.numAterrizajes ?? currentDraft.numAterrizajes ?? 0;
      const esNocturno = mergedCondiciones?.horaria === 'N';

      const completedFlight = {
        ...currentDraft,
        ...extraData,
        horaFin,
        horaFinUTC,
        duracionMinutos,
        aterrizajesDia: esNocturno ? 0 : numAterrizajesFinal,
        aterrizajesNoche: esNocturno ? numAterrizajesFinal : 0,
        status: 'completed',
        updatedAt: new Date().toISOString(),
      };

      setState((s) => ({ ...s, phase: 'saving' }));
      await saveFlight(completedFlight);
      await clearRecordingState();
      _stopForegroundNotification();

      autoStopAtRef.current = null;

      if (autoStopped) {
        setState((s) => ({ ...INITIAL_STATE, phase: 'autoStopped', elapsed: s.elapsed }));
      } else {
        setState(INITIAL_STATE);
      }
      onFlightSaved?.(completedFlight);

      return { success: true, flight: completedFlight };
    } catch (error) {
      console.error('[useFlightSession] stop error:', error);
      setState((s) => ({ ...s, phase: 'recording', error: error.message }));
      return { success: false, reason: error.message };
    }
  }, [onFlightSaved]);

  stopFnRef.current = stop;

  // ── DISCARD ───────────────────────────────────────────────────────────
  const discard = useCallback(async () => {
    clearInterval(timerRef.current);
    clearTimeout(autoStopRef.current);
    await clearRecordingState();
    _stopForegroundNotification();
    draftRef.current = null;
    pendingStopAtRef.current = null;
    autoStopAtRef.current = null;
    preflightDataRef.current = null;
    pendingStartParamsRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  // ── CANCEL PREFLIGHT ─────────────────────────────────────────────────
  // Funciona tanto durante el scanning ('preflight') como tras él ('preflight_done')
const cancelPreflight = useCallback(() => {
    cancelledRef.current = true;
    preflightDataRef.current = null;
    pendingStartParamsRef.current = null;
    setState((s) => ({
      ...s,
      phase:         'idle',
      error:         null,
      eacFizMeta:    null,
      climaMeta:     null,
      cmfMeta:       null,
      batteriesMeta: null,
      preflightStatus: INITIAL_STATE.preflightStatus,
    }));
  }, []);

  // ── CLEAR ERROR ───────────────────────────────────────────────────────
  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  // ── ACKNOWLEDGE AUTO-STOP ─────────────────────────────────────────────
  const acknowledgeAutoStop = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  // ── UPDATE DRAFT (edición durante grabación) ──────────────────────────
  const updateDraft = useCallback(async (fields) => {
    setState((s) => {
      const updatedDraft = { ...s.draft, ...fields, updatedAt: new Date().toISOString() };
      draftRef.current = updatedDraft;
      updateRecordingDraft(updatedDraft).catch(console.error);
      return { ...s, draft: updatedDraft };
    });
  }, []);

  return {
    state,
    isRecording: state.phase === 'recording',
    isPreflight: state.phase === 'preflight' || state.phase === 'preflight_done',
    isPreflightDone: state.phase === 'preflight_done',
    isAutoStopped: state.phase === 'autoStopped',
    start,
    confirmStart,
    stop,
    requestStop,
    cancelStopRequest,
    discard,
    updateDraft,
    runPreflightCheck,
    clearError,
    cancelPreflight,
    acknowledgeAutoStop,
  };
}

// ─── Helpers internos ─────────────────────────────────────────────────────

async function _checkGPS() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn('[FlightOps GPS] navigator.geolocation no disponible');
      resolve({ ok: false, coords: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        ok: true,
        coords: {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          altitude: pos.coords.altitude,
          accuracy: pos.coords.accuracy,
        },
      }),
      (err) => {
        const reasons = { 1: 'PERMISO DENEGADO', 2: 'POSICIÓN NO DISPONIBLE', 3: 'TIMEOUT (8s)' };
        console.warn(`[FlightOps GPS] Fallo: ${reasons[err.code] ?? 'desconocido'} — ${err.message}`);
        resolve({ ok: false, coords: null });
      },
      { timeout: 8000, maximumAge: 30000, enableHighAccuracy: true }
    );
  });
}

async function _fetchClima() {
  try {
    const raw = localStorage.getItem('UPGES_clima_cache');
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (!cache?.current) return null;
    const c = cache.current;
    const descripciones = {
      0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado',
      3: 'Nublado', 45: 'Niebla', 48: 'Niebla con escarcha',
      51: 'Llovizna ligera', 53: 'Llovizna', 55: 'Llovizna intensa',
      61: 'Lluvia ligera', 63: 'Lluvia', 65: 'Lluvia intensa',
      71: 'Nieve ligera', 73: 'Nieve', 75: 'Nieve intensa',
      80: 'Chubascos ligeros', 81: 'Chubascos', 82: 'Chubascos intensos',
      95: 'Tormenta',
    };
    return {
      temp: Math.round(c.temperature_2m),
      viento: `${Math.round(c.wind_speed_10m)} km/h`,
      descripcion: descripciones[c.weather_code] ?? 'Desconocido',
      fuente: 'Open-Meteo',
      capturedAt: cache.cachedAt ? new Date(cache.cachedAt).toISOString() : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function _fetchCMF() {
  try {
    const raw = localStorage.getItem('UPGES_cmf_result');
    if (!raw) return null;
    const result = JSON.parse(raw);
    if (!result?.veredicto) return null;
    return {
      estado: result.veredicto,
      capturedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function _getCMFAge() {
  try {
    const raw = localStorage.getItem('UPGES_cmf_result');
    if (!raw) return null;
    const result = JSON.parse(raw);
    if (!result?.timestamp) return null;
    return Math.floor((Date.now() - result.timestamp) / 60000);
  } catch {
    return null;
  }
}

function _getClimaAge() {
  try {
    const raw = localStorage.getItem('UPGES_clima_cache');
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (!cache?.cachedAt) return null;
    return Math.floor((Date.now() - cache.cachedAt) / 60000);
  } catch {
    return null;
  }
}

async function _fetchEACFIZ(coords) {
  if (!coords?.lat || !coords?.lng) return null;
  try {
    const layers = [];

    // Cargar desde caché primero
    for (const layerConfig of ENAIRE_LAYERS) {
      const data = await getCachedLayer(layerConfig.key);
      if (data) layers.push({ key: layerConfig.key, data });
    }

    // Sin caché → descargar todas las capas en paralelo
    if (layers.length === 0) {
      console.log('[FlightOps EAC/FIZ] Sin caché ENAIRE — descargando capas...');
      const downloads = await Promise.allSettled(
        ENAIRE_LAYERS.map((layerConfig) =>
          fetchLayerGeoJSON(layerConfig.id).then(async (geojson) => {
            await setCachedLayer(layerConfig.key, geojson);
            return { key: layerConfig.key, data: geojson };
          })
        )
      );
      for (const result of downloads) {
        if (result.status === 'fulfilled') layers.push(result.value);
        else console.warn('[FlightOps EAC/FIZ] Fallo descargando capa:', result.reason);
      }
    }

    if (layers.length === 0) {
      return { estado: 'sin_datos', zonas: [], capturedAt: new Date().toISOString() };
    }
    const zones = getZonesAtPoint(coords.lat, coords.lng, layers);
    const hasProhibited = zones.some((z) => z.classification.level === 'prohibited');
    const hasRestricted = zones.some((z) => z.classification.level === 'restricted');
    const hasConditional = zones.some((z) => z.classification.level === 'conditional');
    return {
      estado: zones.length === 0 ? 'sin_restricciones'
        : hasProhibited ? 'prohibido'
          : hasRestricted ? 'restringido'
            : hasConditional ? 'condicional'
              : 'informativo',
      zonas: zones.map((z) => ({
        nombre: z.name,
        nivel: z.classification.level,
        label: z.classification.label,
      })),
      coordsFuente: coords.fuente ?? 'gps',
      coordsNombre: coords.nombre ?? `${coords.lat?.toFixed(4)}, ${coords.lng?.toFixed(4)}`,
      capturedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function _checkBatteries(droneDispositivo) {
  if (!droneDispositivo?.id) {
    return { status: 'na', detail: null };
  }
  try {
    const baterias = await getDispositivosByTipo('bateria');
    const delDrone = baterias.filter((b) => b.droneId === droneDispositivo.id);
    if (delDrone.length === 0) {
      return { status: 'na', detail: 'Sin baterías asignadas' };
    }
    let minNivel = Infinity;
    const detalles = delDrone.map((b) => {
      const nivel = getNivelCargaActual(b);
      if (nivel !== null && nivel < minNivel) minNivel = nivel;
      const nombre = b.alias || `${b.marca ?? ''} ${b.modelo ?? ''}`.trim() || 'Batería';
      return nivel !== null ? `${nombre} ${Math.round(nivel)}%` : `${nombre} Sin datos`;
    });
    const statusVal = minNivel === Infinity ? 'na'
      : minNivel < 30 ? 'error'
        : minNivel < 50 ? 'warn'
          : 'ok';
    return { status: statusVal, detail: detalles.join(' · ') };
  } catch {
    return { status: 'na', detail: null };
  }
}

function _getPresetCoords() {
  try {
    const preset = getSettings()?.mapPreset;
    if (preset?.lat && preset?.lng) return { lat: preset.lat, lng: preset.lng, fuente: 'preset', nombre: preset.name || null };
    const lastLocation = getEnaireUserLocation();
    if (lastLocation?.lat && lastLocation?.lng) return { lat: lastLocation.lat, lng: lastLocation.lng, fuente: 'enaire_cache', nombre: lastLocation.name || null };
  } catch { }
  return null;
}

function _isChecklistDone() {
  return isNormativaChecklistDone();
}

function _startForegroundNotification() {
  // PENDIENTE: plugin nativo Capacitor para notificación persistente en Android
  console.log('[FlightOps] Foreground notification START');
}

function _stopForegroundNotification() {
  // PENDIENTE: cancelar notificación persistente
  console.log('[FlightOps] Foreground notification STOP');
}