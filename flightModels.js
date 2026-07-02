/**
 * flightModels.js — BioKaizen Solutions / UPGES v1
 * Modelos de datos + factories para Flight Ops
 * Referencia: AESA Apéndice M + campos extra BioKaizen
 *
 * IMPORTANTE — relación con dispositivosDB.js:
 * Un dispositivo (drone o batería) se referencia en el vuelo mediante un
 * patrón híbrido FK + snapshot inmutable:
 *   - FK (droneId / bateriaId) → permite joins/filtros mientras el dispositivo exista
 *   - snapshot (droneSnapshot / entradas de baterias[]) → copia inmutable capturada
 *     en el momento del vuelo, para que el registro legal AESA nunca cambie
 *     retroactivamente si el dispositivo se edita o se borra después.
 *
 * Campos reales de un dispositivo (dispositivosDB.js, store 'dispositivos'):
 *   id, tipo, alias, marca, modelo, numeroDeSerie, droneId (FK en accesorios),
 *   nivelCarga, totalCargas, ultimaCarga, alertaDegradacion,
 *   alertaMaxDiasSinCarga, alertaMaxCiclos, fechaUltimaInspeccion, fechaFinGarantia
 */

import { nanoid } from 'nanoid'; // npm i nanoid

// ─── Enums / constantes ──────────────────────────────────────────────────

export const FUNCION_PILOTO = {
  PIC: 'PIC',           // Pilot in Command
  SPIC: 'SPIC',         // Student PIC
  COPILOTO: 'Copiloto',
  INSTRUCTOR: 'Instructor',
};

export const CONDICION_HORARIA = {
  DIA: 'D',
  NOCHE: 'N',
};

export const CONDICION_VISUAL = {
  VLOS: 'VLOS',
  EVLOS: 'EVLOS',
  BVLOS: 'BVLOS',
};

export const TIPO_OPERACION = {
  A1: 'A1',
  A2: 'A2',
  A3: 'A3',
  STS01: 'STS-01',
  STS02: 'STS-02',
  ESPECIFICA: 'Específica',
};

export const VUELO_STATUS = {
  DRAFT: 'draft',         // Vuelo en curso (activeSession)
  COMPLETED: 'completed', // Guardado en flights store
  MANUAL: 'manual',       // Introducido manualmente sin START/STOP
};

export const ACTIVIDAD = [
  'Fotografía/Vídeo',
  'Inspección infraestructuras',
  'Inspección agrícola/NDVI',
  'Topografía/Fotogrametría',
  'Termografía',
  'Búsqueda y rescate',
  'Entrenamiento/Formación',
  'Pruebas/Mantenimiento',
  'Recreativo',
  'Otro',
];

// Entorno de la operación — taxonomía propia BioKaizen (no es campo AESA),
// reemplaza al antiguo booleano "entornoUrbano" por insuficiente.
export const ENTORNO = [
  'Urbano',
  'Rural',
  'Playa / Costa',
  'Montaña',
  'Industrial',
  'Cerca de edificios',
  'Espacio despejado',
];

// ─── Factory: snapshot inmutable del dron ─────────────────────────────────

/**
 * createDroneSnapshot(droneDispositivo)
 * Construye el snapshot inmutable del dron para un vuelo, capturado en START.
 * Si el dispositivo no tiene alias propio, usa "marca modelo" como fallback
 * (mismo patrón que getDispositivoDisplayName en dispositivosDB.js).
 * @param {Object} droneDispositivo — objeto completo de dispositivosDB.js (tipo='drone')
 */
export function createDroneSnapshot(droneDispositivo) {
  if (!droneDispositivo) {
    return { alias: null, marca: null, modelo: null, numeroDeSerie: null };
  }
  const fallbackAlias = `${droneDispositivo.marca ?? ''} ${droneDispositivo.modelo ?? ''}`.trim() || null;
  return {
    alias: droneDispositivo.alias || fallbackAlias,
    marca: droneDispositivo.marca ?? null,
    modelo: droneDispositivo.modelo ?? null,
    numeroDeSerie: droneDispositivo.numeroDeSerie ?? null,
  };
}

// ─── Factory: snapshot inmutable de batería ───────────────────────────────

/**
 * createBateriaSnapshot(bateriaDispositivo)
 * Construye la entrada híbrida (FK + snapshot) para el array `baterias[]` de un vuelo.
 * @param {Object} bateriaDispositivo — objeto completo de dispositivosDB.js (tipo='bateria')
 */
export function createBateriaSnapshot(bateriaDispositivo) {
  if (!bateriaDispositivo) {
    return { bateriaId: null, alias: null, numeroDeSerie: null, ciclosEnEsteVuelo: null };
  }
  return {
    bateriaId: bateriaDispositivo.id,
    alias: bateriaDispositivo.alias || `${bateriaDispositivo.marca ?? ''} ${bateriaDispositivo.modelo ?? ''}`.trim() || null,
    numeroDeSerie: bateriaDispositivo.numeroDeSerie ?? null,
    ciclosEnEsteVuelo: bateriaDispositivo.totalCargas ?? null,
  };
}

// ─── Factory: Vuelo completo (AESA Apéndice M) ──────────────────────────

/**
 * createFlight(overrides)
 * Genera un objeto Flight con todos los campos en valores por defecto,
 * aplicando después cualquier override pasado por el llamante.
 *
 * FIX CRÍTICO: versiones anteriores de esta función ignoraban por completo
 * el parámetro `overrides` — el objeto devuelto eran siempre los valores
 * fijos, nunca lo que el llamante pasaba (horaInicio, droneSnapshot,
 * coordenadas, etc. quedaban siempre en null/default). Corregido aquí con
 * el spread final `{ ...base, ...overrides }`.
 *
 * Se usa tanto para vuelos nuevos (START) como para entrada manual.
 */
export function createFlight(overrides = {}) {
  const now = new Date();

  const base = {
    // ── Identificación ────────────────────────────────────────────────
    id: nanoid(),
    status: VUELO_STATUS.DRAFT,

    // ── Temporales (AESA obligatorio) ─────────────────────────────────
    fecha: toDateString(now),        // 'YYYY-MM-DD'
    horaInicio: null,                // 'HH:MM' hora local del dispositivo
    horaInicioUTC: null,             // 'HH:MM' UTC — Apéndice M AESA columna 3
    horaFin: null,                   // 'HH:MM' hora local del dispositivo
    horaFinUTC: null,                // 'HH:MM' UTC — Apéndice M AESA columna 3
    duracionMinutos: null,           // Calculado al STOP
    numAterrizajes: 1,
    aterrizajesDia: 0,    // Derivado de condicionesOp.horaria al STOP — Apéndice M exige desglose D/N
    aterrizajesNoche: 0,

    // ── Localización ─────────────────────────────────────────────────
    lugar: '',
    coordenadas: {
      lat: null,
      lng: null,
      altitud: null,                 // metros MSL
      precision: null,               // metros (GPS accuracy)
      fuente: 'gps',                 // 'gps' | 'manual' | 'spot'
    },
    spotId: null,                    // FK flightSpotsDB.js si aplica

    // ── Equipamiento (AESA obligatorio) ────────────────────────────────
    // Patrón híbrido FK + snapshot: ver cabecera del archivo.
    droneId: null,                   // FK dispositivosDB.js (tipo='drone')
    droneSnapshot: {                 // Copia inmutable capturada en START
      alias: null,
      marca: null,
      modelo: null,
      numeroDeSerie: null,
    },
    // Se rellena en STOP, no en START — el piloto confirma qué baterías usó
    // al finalizar el vuelo (puede haber cambiado de batería durante el vuelo).
    baterias: [],                    // [{ bateriaId, alias, numeroDeSerie, ciclosEnEsteVuelo }]

    // ── Operación ────────────────────────────────────────────────────
    actividad: '',                   // Ahora se pide ANTES de START, junto al dron
    condicionesOp: {
      horaria: CONDICION_HORARIA.DIA,
      visual: CONDICION_VISUAL.VLOS,
      entorno: '',                   // Ver ENTORNO — se confirma en STOP
    },
    funcionPiloto: FUNCION_PILOTO.PIC,
    observaciones: '',

    // ── Campos PRO (ocultos si !isPro) ───────────────────────────────
    pro: {
      cliente: '',
      facturado: false,
      gastos: null,                  // EUR
      tipoOperacion: null,
      permisoAESA: '',
      numOperadorUAS: '',            // Nº de operador AESA (de la organización, no del dron)
      observador: '',
    },

    // ── Contexto capturado automáticamente en START ───────────────────
contexto: {
      clima: null,                   // { temp, viento, descripcion, fuente, capturedAt }
      cmf: null,                     // { estado, capturedAt }
      eacFiz: null,                  // { estado, zonas[], capturedAt } — EAC/FIZ ENAIRE en START
      checklistId: null,             // FK checklists
      checklistAprobado: null,       // true/false
    },

    // ── Multimedia (PRO) ─────────────────────────────────────────────
    mediaIds: [],                    // FK media store

    // ── Sistema ──────────────────────────────────────────────────────
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    syncedAt: null,                  // para futura sincronización
  };

  return { ...base, ...overrides };
}

// ─── Factory: Sesión activa ───────────────────────────────────────────────

/**
 * createActiveSession(flightDraft)
 * Wrapper que se guarda en store 'activeSession' con key='current'.
 * Capacitor Preferences guarda SOLO el flag + id (no el draft completo).
 */
export function createActiveSession(flightDraft) {
  return {
    key: 'current',                  // keyPath fijo
    flightId: flightDraft.id,
    startedAt: new Date().toISOString(),
    autoStopAt: null,                // ISO string si hay timeout configurado
    draft: flightDraft,              // snapshot completo del vuelo en curso
  };
}

// ─── Factory: Checklist result ───────────────────────────────────────────

export function createChecklistResult(overrides = {}) {
  return {
    id: nanoid(),
    flightId: null,                  // se asigna al vincular con vuelo
    nivel: 1,                        // 1 | 2 | 3
    timestamp: new Date().toISOString(),
    items: {
      // Nivel 1 (siempre)
      gpsAcquired: null,             // true/false
      droneSeleccionado: null,
      // Nivel 2 (configurable)
      checklistCompleto: null,
      cmfActualizado: null,          // < Xh de antigüedad
      climaFresco: null,             // < Xh de antigüedad
    },
    aprobado: false,
    ...overrides,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' desde Date object */
export function toDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** 'HH:MM' desde Date object (hora local) — sin dependencia de locale del dispositivo */
export function toTimeString(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** 'HH:MM' en UTC desde Date object — garantizado en cualquier dispositivo/WebView */
export function toUTCTimeString(date = new Date()) {
  return date.toISOString().slice(11, 16);
}

/** Calcula duracion en minutos entre dos strings 'HH:MM' */
export function calcDuracionMinutos(horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return null;
  const [h1, m1] = horaInicio.split(':').map(Number);
  const [h2, m2] = horaFin.split(':').map(Number);
  const minutos = (h2 * 60 + m2) - (h1 * 60 + m1);
  return minutos >= 0 ? minutos : minutos + 1440; // cruce medianoche
}

/**
 * Determina Día/Noche por defecto según la hora actual, con aproximación
 * de horario de verano/invierno. Es una estimación (no cálculo astronómico
 * exacto de orto/ocaso) — el piloto puede corregirlo siempre.
 */
export function getDefaultHoraria(date = new Date()) {
  const month = date.getMonth(); // 0=enero … 11=diciembre
  const hour = date.getHours() + date.getMinutes() / 60;

  // Aproximación horario de verano (finales marzo–finales octubre)
  const veranoAprox = month >= 2 && month <= 9;
  const amanecer = veranoAprox ? 7 : 8;
  const atardecer = veranoAprox ? 21.5 : 19;

  return hour >= amanecer && hour < atardecer ? CONDICION_HORARIA.DIA : CONDICION_HORARIA.NOCHE;
}

// Gaps de cumplimiento Apéndice M AESA detectados — pendientes de captura,
// mostrados como aviso no bloqueante en Sesión y Dashboard hasta resolverse.
// Categoría de aeronave: siempre multirrotor (app UAS), implícito, no hace falta registrarlo.
// EV/ES: esta app es para vuelo real, no simulador, no aplica.
// Hora UTC: se captura automáticamente en horaInicioUTC/horaFinUTC (ver createFlight).
export const AESA_COMPLIANCE_NOTES = [];
// EAC/FIZ implementado en v1 — capturado automáticamente en START mediante caché ENAIRE

/** Formatea minutos como 'Xh Ym' */
export function formatDuracion(minutos) {
  if (minutos == null) return '--';
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}