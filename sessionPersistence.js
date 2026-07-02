/**
 * sessionPersistence.js — BioKaizen Solutions / UPGES v1
 *
 * Capa de persistencia del estado "grabando" entre cierres de app.
 *
 * ESTRATEGIA (3 capas, más robusta posible):
 * ┌─────────────────────────────────────────────────────┐
 * │ Capa 1 — Capacitor Preferences (nativo iOS/Android) │
 * │   Guarda: { recording: bool, flightId, startedAt }  │
 * │   Survives: app kill, OS, reboot                    │
 * ├─────────────────────────────────────────────────────┤
 * │ Capa 2 — IndexedDB store 'activeSession'            │
 * │   Guarda: draft completo del vuelo en curso         │
 * │   Survives: página cerrada, recarga                 │
 * ├─────────────────────────────────────────────────────┤
 * │ Capa 3 — localStorage (fallback web/dev)            │
 * │   Guarda: mismo JSON que Capacitor                  │
 * │   Survives: recarga (no kill en móvil nativo)       │
 * └─────────────────────────────────────────────────────┘
 *
 * Al arrancar la app → checkRecordingState() reconcilia las 3 capas
 * y devuelve el draft si había grabación en curso.
 */

import { Preferences } from '@capacitor/preferences';
import { getActiveSession, saveActiveSession, deleteActiveSession } from './flightOpsDB';

const PREF_KEY = 'flight_ops_recording_state';
const LS_KEY = 'upges_recording_state';

// ─── Capacitor Preferences helpers ───────────────────────────────────────

async function prefSet(data) {
  try {
    await Preferences.set({ key: PREF_KEY, value: JSON.stringify(data) });
  } catch (e) {
    console.warn('[SessionPersistence] Capacitor Preferences unavailable:', e);
  }
}

async function prefGet() {
  try {
    const { value } = await Preferences.get({ key: PREF_KEY });
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

async function prefRemove() {
  try {
    await Preferences.remove({ key: PREF_KEY });
  } catch {
    // silently ignore
  }
}

// ─── localStorage helpers (fallback) ────────────────────────────────────

function lsSet(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    // quota exceeded or private mode
  }
}

function lsGet() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function lsRemove() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Persiste el estado de grabación activa en las 3 capas.
 * Llamar inmediatamente después de START.
 *
 * @param {Object} session — createActiveSession() result
 */
export async function persistRecordingStart(session) {
  const stateFlag = {
    recording: true,
    flightId: session.flightId,
    startedAt: session.startedAt,
    autoStopAt: session.autoStopAt,
  };

  // Capa 1 — Capacitor (más robusta en nativo)
  await prefSet(stateFlag);

  // Capa 2 — IndexedDB (draft completo)
  await saveActiveSession(session);

  // Capa 3 — localStorage (fallback)
  lsSet(stateFlag);
}

/**
 * Actualiza el draft del vuelo en curso sin tocar el flag de Capacitor.
 * Llamar cuando el usuario edita campos durante la grabación.
 *
 * @param {Object} updatedDraft — flight draft actualizado
 */
export async function updateRecordingDraft(updatedDraft) {
  const session = await getActiveSession();
  if (!session) return;

  await saveActiveSession({
    ...session,
    draft: {
      ...updatedDraft,
      updatedAt: new Date().toISOString(),
    },
  });
}

/**
 * Limpia el estado de grabación de todas las capas.
 * Llamar después de STOP (tanto si se completa como si se descarta).
 */
export async function clearRecordingState() {
  // BUG FIX #2: limpiar Preferences PRIMERO (fuente de verdad del flag).
  // Si la app muere a mitad, checkRecordingState verá recording=false
  // y limpiará IDB correctamente en la próxima ejecución.
  await prefRemove();
  lsRemove();
  await deleteActiveSession();
}

/**
 * Comprueba si hay una grabación en curso al arrancar la app.
 * Reconcilia las 3 capas y devuelve el draft si existe.
 *
 * @returns {{ isRecording: boolean, session: Object|null, flightId: string|null }}
 */
export async function checkRecordingState() {
  // Leer las 3 capas
  const [prefState, idbSession, lsState] = await Promise.all([
    prefGet(),
    getActiveSession(),
    Promise.resolve(lsGet()),
  ]);

  // No hay nada → clean state
  if (!prefState && !idbSession && !lsState) {
    return { isRecording: false, session: null, flightId: null };
  }

  // Fuente de verdad: Capacitor Preferences (más confiable en nativo)
  // Fallback: localStorage → IDB
  const flagState = prefState ?? lsState;

  if (!flagState?.recording) {
    // Flag dice que no graba → limpiar posibles restos huérfanos en IDB
    if (idbSession) await deleteActiveSession();
    return { isRecording: false, session: null, flightId: null };
  }

  // Hay grabación activa — verificar coherencia con IDB
  if (idbSession && idbSession.flightId !== flagState.flightId) {
    await deleteActiveSession();
    return {
      isRecording: true,
      session: null,
      flightId: flagState.flightId,
      startedAt: flagState.startedAt ?? null,  // BUG FIX #1
      autoStopAt: flagState.autoStopAt ?? null,  // BUG FIX #1
      recoveryMode: 'partial',
    };
  }

  return {
    isRecording: true,
    session: idbSession ?? null,
    flightId: flagState.flightId,
    startedAt: flagState.startedAt,
    recoveryMode: idbSession ? 'full' : 'partial',
  };
}

/**
 * Detecta si el auto-stop ha vencido.
 * @returns {boolean}
 */
export async function isAutoStopExpired() {
  const state = await prefGet();
  if (!state?.autoStopAt) return false;
  return new Date() > new Date(state.autoStopAt);
}