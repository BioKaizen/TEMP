/**
 * flightOpsDB.js — BioKaizen Solutions / UPGES v1
 * IndexedDB schema para Flight Ops (Log Book AESA Apéndice M)
 *
 * IMPORTANTE: este módulo NO almacena drones ni baterías — esos viven
 * exclusivamente en dispositivosDB.js (DB 'UPGES_dispositivos'). Un vuelo
 * referencia un dispositivo mediante el patrón híbrido FK + snapshot
 * (ver flightModels.js: droneId/droneSnapshot, baterias[]).
 *
 * Versión DB: 1
 * Estrategia de persistencia "grabando" (ver sessionPersistence.js):
 *   - Capacitor Preferences → fuente de verdad del estado (survives kills)
 *   - IndexedDB store 'activeSession' → draft del vuelo en curso
 *   - localStorage → fallback web (dev/test)
 */

const DB_NAME    = 'UPGES_flight_ops';
const DB_VERSION = 1;
const OPEN_TIMEOUT_MS = 10_000; // 10s — si el upgrade está bloqueado, rechazar

export const EVENT_FLIGHTS_UPDATED = 'upges:flightOpsUpdated';

// ─── Store names ──────────────────────────────────────────────────────────
export const STORES = {
  FLIGHTS:        'flights',        // Vuelos completados (log book principal)
  ACTIVE_SESSION: 'activeSession',  // Máx. 1 registro: el vuelo en curso (key='current')
  CHECKLISTS:     'checklists',     // Resultados de pre-flight checks
  MEDIA:          'media',          // Fotos/videos (blobs, PRO)
};

// ─── Schema upgrade handler ───────────────────────────────────────────────
function onUpgradeNeeded(event) {
  const db         = event.target.result;
  const oldVersion = event.oldVersion;

  if (oldVersion < 1) {
    const flightsStore = db.createObjectStore(STORES.FLIGHTS, { keyPath: 'id' });
    flightsStore.createIndex('fecha',        'fecha',        { unique: false });
    flightsStore.createIndex('droneId',      'droneId',      { unique: false });
    flightsStore.createIndex('lugar',        'lugar',        { unique: false });
    flightsStore.createIndex('funcionPiloto','funcionPiloto',{ unique: false });
    flightsStore.createIndex('actividad',    'actividad',    { unique: false });
    flightsStore.createIndex('createdAt',    'createdAt',    { unique: false });
    flightsStore.createIndex('fecha_droneId',['fecha','droneId'], { unique: false });

    db.createObjectStore(STORES.ACTIVE_SESSION, { keyPath: 'key' });

    const checklistsStore = db.createObjectStore(STORES.CHECKLISTS, { keyPath: 'id' });
    checklistsStore.createIndex('flightId',  'flightId',  { unique: false });
    checklistsStore.createIndex('timestamp', 'timestamp', { unique: false });

    const mediaStore = db.createObjectStore(STORES.MEDIA, { keyPath: 'id' });
    mediaStore.createIndex('flightId', 'flightId', { unique: false });
    mediaStore.createIndex('tipo',     'tipo',     { unique: false });
  }
}

// ─── Singleton DB connection ──────────────────────────────────────────────
let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    // BUG FIX #2: timeout para evitar que la Promise se cuelgue si el upgrade
    // está bloqueado por otra pestaña (onblocked solo advertía, no rechazaba).
    const timeoutId = setTimeout(() => {
      reject(new Error('[flightOpsDB] Timeout abriendo la base de datos — cierra otras pestañas'));
    }, OPEN_TIMEOUT_MS);

    const clearAndReject = (err) => { clearTimeout(timeoutId); reject(err); };
    const clearAndResolve = (db) => { clearTimeout(timeoutId); resolve(db); };

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = onUpgradeNeeded;

    request.onsuccess = (e) => {
      _db = e.target.result;

      // BUG FIX #1: manejar cierre inesperado de conexión (presión de memoria en móviles).
      // Sin este handler, _db quedaba apuntando a una conexión cerrada y todos los
      // CRUD fallaban silenciosamente.
      _db.onclose = () => {
        console.warn('[flightOpsDB] Conexión cerrada inesperadamente — se reabrirá en la próxima operación');
        _db = null;
      };

      _db.onversionchange = () => {
        _db.close();
        _db = null;
      };

      clearAndResolve(_db);
    };

    request.onerror = (e) => clearAndReject(e.target.error);

    request.onblocked = () => {
      console.warn('[flightOpsDB] Upgrade bloqueado — esperando cierre de otras pestañas...');
      // No rechazamos aquí — el timeout lo hará si supera OPEN_TIMEOUT_MS
    };
  });
}

// ─── CRUD: flights ────────────────────────────────────────────────────────

export async function getAllFlights() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORES.FLIGHTS, 'readonly');
    const req = tx.objectStore(STORES.FLIGHTS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

export async function getFlightById(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORES.FLIGHTS, 'readonly');
    const req = tx.objectStore(STORES.FLIGHTS).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

export async function saveFlight(flight) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.FLIGHTS, 'readwrite');
    tx.objectStore(STORES.FLIGHTS).put(flight);
    tx.oncomplete = () => {
      window.dispatchEvent(new Event(EVENT_FLIGHTS_UPDATED));
      resolve(flight);
    };
    // BUG FIX #3: escuchar tanto onerror como onabort en escrituras críticas
    tx.onerror  = () => reject(tx.error);
    tx.onabort  = () => reject(tx.error ?? new Error('[flightOpsDB] Transacción abortada al guardar vuelo'));
  });
}

export async function deleteFlight(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.FLIGHTS, 'readwrite');
    tx.objectStore(STORES.FLIGHTS).delete(id);
    tx.oncomplete = () => {
      window.dispatchEvent(new Event(EVENT_FLIGHTS_UPDATED));
      resolve(true);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('[flightOpsDB] Transacción abortada al eliminar vuelo'));
  });
}

// ─── CRUD: activeSession ──────────────────────────────────────────────────

export async function getActiveSession() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORES.ACTIVE_SESSION, 'readonly');
    const req = tx.objectStore(STORES.ACTIVE_SESSION).get('current');
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

export async function saveActiveSession(session) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.ACTIVE_SESSION, 'readwrite');
    tx.objectStore(STORES.ACTIVE_SESSION).put(session);
    tx.oncomplete = () => resolve(session);
    tx.onerror  = () => reject(tx.error);
    tx.onabort  = () => reject(tx.error ?? new Error('[flightOpsDB] Transacción abortada al guardar sesión activa'));
  });
}

export async function deleteActiveSession() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.ACTIVE_SESSION, 'readwrite');
    tx.objectStore(STORES.ACTIVE_SESSION).delete('current');
    tx.oncomplete = () => resolve(true);
    tx.onerror  = () => reject(tx.error);
    tx.onabort  = () => reject(tx.error ?? new Error('[flightOpsDB] Transacción abortada al eliminar sesión activa'));
  });
}

// ─── CRUD: checklists ─────────────────────────────────────────────────────

export async function getChecklistsByFlight(flightId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORES.CHECKLISTS, 'readonly');
    const index = tx.objectStore(STORES.CHECKLISTS).index('flightId');
    const req   = index.getAll(IDBKeyRange.only(flightId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

export async function saveChecklistResult(checklist) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CHECKLISTS, 'readwrite');
    tx.objectStore(STORES.CHECKLISTS).put(checklist);
    tx.oncomplete = () => resolve(checklist);
    tx.onerror  = () => reject(tx.error);
    tx.onabort  = () => reject(tx.error ?? new Error('[flightOpsDB] Transacción abortada al guardar checklist'));
  });
}