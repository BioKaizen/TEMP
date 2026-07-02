/**
 * flightOpsPDF.js — BioKaizen Solutions / UPGES v1
 * Exportación PDF del Log Book en formato Apéndice M AESA (rev.2, 30/12/2019)
 *
 * Columnas oficiales Apéndice M:
 *   1. Fecha            2. Lugar           3. Horas UTC (sal/lle)
 *   4. RPAS             5. T.Vuelo         6. Aterrizajes D/N
 *   7. Actividad+Cód.   8. Función/Horas   9. Observaciones
 *
 * Estética: paleta cockpit UPGES — cabeceras oscuras #0a1624 / #7eb8d4,
 * filas claras (imprimibles), totales en verde #00c896.
 * Marca de agua: igual que inventarioPDF.js.
 */

import { jsPDF } from 'jspdf';
import { saveBlobAsFile } from '@/lib/fileExport';

// ─── Paleta cockpit ───────────────────────────────────────────────────────
const C = {
  // Cabeceras
  HDR_BG: [8, 20, 36],   // #081424 — fondo cabecera página
  HDR_TXT: [126, 184, 212],   // #7eb8d4 — texto cabecera
  HDR_ACC: [0, 180, 230],   // acento cyan línea separadora

  // Cabecera tabla
  THDR_BG: [10, 26, 44],   // fondo cabecera tabla
  THDR_TXT: [200, 225, 240],   // texto cabecera tabla

  // Filas datos (claras — imprimibles)
  ROW_EVEN: [243, 248, 254],   // fila par
  ROW_ODD: [255, 255, 255],   // fila impar

  // Texto datos
  DATA_TXT: [25, 40, 70],
  MUTED: [100, 130, 160],

  // Separadores
  BORDER: [160, 190, 215],
  BORDER_H: [80, 120, 160],

  // Totales
  TOT_BG: [6, 28, 20],   // fondo fila totales
  TOT_TXT: [0, 200, 150],   // #00c896 verde cockpit

  // Firma
  SIG_TXT: [120, 140, 160],

  // Watermark (idéntica a inventarioPDF)
  WM_TXT: [210, 220, 235],
};

// ─── Layout A4 landscape ──────────────────────────────────────────────────
const PW = 297;
const PH = 210;
const ML = 8;
const MT = 10;
const MB = 12;
const CW = PW - ML * 2; // 281mm

// Columnas — total 281mm
const COLS = [
  { key: 'fecha', label: 'FECHA\n(dd/mm/aa)', w: 20 },
  { key: 'lugar', label: 'LUGAR DE\nOPERACION', w: 28 },
  { key: 'horas', label: 'HORAS UTC\nSAL / LLE', w: 22 },
  { key: 'rpas', label: 'RPAS CATEGORIA,\nMARCA, MODELO', w: 38 },
  { key: 'registro', label: 'REGISTRO\n(S/N)', w: 33 },
  { key: 'tiempo', label: 'T.VUELO\nhh:mm', w: 15 },
  { key: 'aterrizajes', label: 'ATERR.\nD / N', w: 16 },
  { key: 'actividad', label: 'ACTIVIDAD Y CONDICIONES\nOPERACIONALES', w: 57 },
  { key: 'funcion', label: 'FUNCION\nPILOTO/h', w: 22 },
  { key: 'obs', label: 'OBSERVACIONES\nY ANOTACIONES', w: 30 },
];
// 20+28+22+38+33+15+16+57+22+30 = 281 ✓

const ROW_H = 10;
const HDR_H = 12;
const FONT_HDR = 6.5;
const FONT_DAT = 7;

// ─── Helpers ──────────────────────────────────────────────────────────────

function sanitize(text) {
  return String(text || '')
    .replace(/[→]/g, '->').replace(/[≥]/g, '>=').replace(/[≤]/g, '<=')
    .replace(/[✓✔]/g, '+').replace(/[«»""]/g, '"')
    .replace(/['']/g, "'").replace(/[–—]/g, '-')
    .replace(/[^\x00-\x7F]/g, (c) => {
      const map = {
        'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n',
        'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ü': 'U', 'Ñ': 'N',
      };
      return map[c] ?? '';
    });
}

function fmtDate(iso) {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtHHMM(minutes) {
  if (minutes == null) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function buildCodigos(flight) {
  const parts = [flight.actividad || '-'];
  const visual = flight.condicionesOp?.visual;
  if (visual) parts.push(visual);
  if (flight.condicionesOp?.horaria === 'N') parts.push('N');
  const ent = (flight.condicionesOp?.entorno || '').toLowerCase();
  if (ent.includes('urban')) parts.push('EU');
  return sanitize(parts.join(', '));
}

function clip(text, maxChars) {
  const s = sanitize(text);
  return s.length > maxChars ? s.slice(0, maxChars - 1) + '.' : s;
}

// ─── Marca de agua (idéntica a inventarioPDF.js) ──────────────────────────

function addWatermark(doc) {
  doc.saveGraphicsState();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(52);
  doc.setTextColor(...C.WM_TXT);
  // Posición ajustada a landscape A4
  doc.text('UAS Pocket Guide ES', PW / 4, PH / 2 + 40, { angle: 45 });
  doc.restoreGraphicsState();
}

// ─── Cabecera de página ───────────────────────────────────────────────────

function drawPageHeader(doc, pageNum) {
  // Marca de agua primero — queda detrás de todo el contenido
  addWatermark(doc);
  // Fondo oscuro cabecera
  doc.setFillColor(...C.HDR_BG);
  doc.rect(0, 0, PW, MT + 11, 'F');

  // Línea accent cyan
  doc.setFillColor(...C.HDR_ACC);
  doc.rect(0, 0, PW, 1.5, 'F');

  // Título
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C.HDR_TXT);
  doc.text('LIBRO DE VUELO DEL PILOTO REMOTO', ML, MT + 4);

  // Subtítulo normativo
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...C.MUTED);
  doc.text('Apendice M, rev.2 · RD 1036/2017 arts. 36 y 37 · AESA', ML, MT + 8);

  // Fecha generación + página (derecha)
  const gen = `Generado: ${new Date().toLocaleDateString('es-ES')}`;
  doc.setTextColor(...C.HDR_TXT);
  doc.setFontSize(7.5);
  doc.text(gen, PW - ML, MT + 4, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.text(`Pag. ${pageNum}`, PW - ML, MT + 8, { align: 'right' });

  return MT + 17; // y donde empieza la tabla (gap entre header y tabla)
}

// ─── Cabecera de tabla ────────────────────────────────────────────────────

function drawTableHeader(doc, y) {
  doc.setFillColor(...C.THDR_BG);
  doc.rect(ML, y, CW, HDR_H, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_HDR);
  doc.setTextColor(...C.THDR_TXT);

  let x = ML;
  COLS.forEach((col) => {
    const lines = col.label.split('\n');
    const lineH = 3.5;
    const totalH = lines.length * lineH;
    const startY = y + (HDR_H - totalH) / 2 + lineH * 0.85;
    lines.forEach((line, i) => {
      doc.text(sanitize(line), x + 1.5, startY + i * lineH, { maxWidth: col.w - 3 });
    });
    // Separador vertical sutil
    if (x + col.w < ML + CW) {
      doc.setDrawColor(...C.BORDER_H);
      doc.setLineWidth(0.2);
      doc.line(x + col.w, y + 1, x + col.w, y + HDR_H - 1);
    }
    x += col.w;
  });

  // Borde exterior tabla
  doc.setDrawColor(...C.BORDER_H);
  doc.setLineWidth(0.5);
  doc.rect(ML, y, CW, HDR_H);

  return y + HDR_H;
}

// ─── Fila de datos ────────────────────────────────────────────────────────

function drawDataRow(doc, y, rowData, isEven) {
  // Fondo alternado claro (imprimible)
  doc.setFillColor(...(isEven ? C.ROW_EVEN : C.ROW_ODD));
  doc.rect(ML, y, CW, ROW_H, 'F');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT_DAT);
  doc.setTextColor(...C.DATA_TXT);

  let x = ML;
  COLS.forEach((col) => {
    const val = rowData[col.key] ?? '-';
    const maxC = Math.floor((col.w - 3) / 1.45);
    const text = clip(String(val), maxC);
    doc.text(text, x + 1.5, y + ROW_H * 0.63, { maxWidth: col.w - 3 });

    if (x + col.w < ML + CW) {
      doc.setDrawColor(...C.BORDER);
      doc.setLineWidth(0.15);
      doc.line(x + col.w, y, x + col.w, y + ROW_H);
    }
    x += col.w;
  });

  // Borde inferior fila
  doc.setDrawColor(...C.BORDER);
  doc.setLineWidth(0.2);
  doc.line(ML, y + ROW_H, ML + CW, y + ROW_H);

  // Bordes laterales
  doc.setDrawColor(...C.BORDER_H);
  doc.setLineWidth(0.4);
  doc.line(ML, y, ML, y + ROW_H);
  doc.line(ML + CW, y, ML + CW, y + ROW_H);

  return y + ROW_H;
}

// ─── Fila de totales ──────────────────────────────────────────────────────

function drawTotalsRow(doc, y, totals) {
  doc.setFillColor(...C.TOT_BG);
  doc.rect(ML, y, CW, ROW_H, 'F');

  // Borde accent green
  doc.setDrawColor(...C.TOT_TXT);
  doc.setLineWidth(0.6);
  doc.rect(ML, y, CW, ROW_H);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_DAT);
  doc.setTextColor(...C.TOT_TXT);

  doc.text('TOTAL ACUMULADO', ML + 1.5, y + ROW_H * 0.63);

  const offTiempo = COLS.slice(0, 5).reduce((a, c) => a + c.w, 0);
  doc.text(fmtHHMM(totals.totalMinutos), ML + offTiempo + 1.5, y + ROW_H * 0.63);

  const offAterr = COLS.slice(0, 6).reduce((a, c) => a + c.w, 0);
  doc.text(`${totals.dia} / ${totals.noche}`, ML + offAterr + 1.5, y + ROW_H * 0.63);

  return y + ROW_H;
}

// ─── Línea de firma ───────────────────────────────────────────────────────

function drawSignatureLine(doc, y) {
  if (y + 16 > PH - MB) return;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(...C.SIG_TXT);
  doc.text('Certifico que todo lo anotado es verdad', PW - ML - 72, y + 5);
  doc.setDrawColor(...C.BORDER_H);
  doc.setLineWidth(0.4);
  doc.line(PW - ML - 68, y + 11, PW - ML, y + 11);
  doc.text('Firma del piloto', PW - ML - 36, y + 14.5);
}

// ─── Pie de página ────────────────────────────────────────────────────────

function drawPageFooter(doc, pageNum, totalPages) {
  // Línea separadora
  doc.setDrawColor(...C.BORDER);
  doc.setLineWidth(0.3);
  doc.line(ML, PH - MB + 1, PW - ML, PH - MB + 1);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...C.MUTED);
  doc.text(
    'Documento generado por UPGES (UAS Pocket Guide ES) — BioKaizen Solutions · Multirrotor (categoria abierta)',
    ML, PH - 4
  );
  doc.text(`${pageNum} / ${totalPages}`, PW - ML, PH - 4, { align: 'right' });
}

// ─── API pública ──────────────────────────────────────────────────────────

/**
 * Genera y descarga el PDF del Log Book AESA (Apéndice M).
 * @param {Object[]} flights — array de vuelos del store UPGES_flight_ops
 */
export async function exportFlightsPDF(flights) {
  if (!flights?.length) return null;

  const sorted = [...flights].sort((a, b) =>
    (a.fecha ?? '').localeCompare(b.fecha ?? '')
  );

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const usableH = PH - MT - MB - 24 - HDR_H;
  const rowsPerPage = Math.floor(usableH / ROW_H);
  const totalPages = Math.ceil(sorted.length / rowsPerPage);

  let currentPage = 1;
  let rowIndex = 0;
  let y = 0;
  const totals = { totalMinutos: 0, dia: 0, noche: 0 };

  // Primera página
  y = drawPageHeader(doc, currentPage);
  y = drawTableHeader(doc, y);

  for (const flight of sorted) {
    // Salto de página
    if (y + ROW_H > PH - MB - ROW_H - 2) {
      drawPageFooter(doc, currentPage, totalPages);
      doc.addPage();
      currentPage++;
      y = drawPageHeader(doc, currentPage);
      y = drawTableHeader(doc, y);
    }

    const snap = flight.droneSnapshot ?? {};
    const modelo = [snap.marca, snap.modelo].filter(Boolean).join(' ') || snap.alias || '-';

    const rowData = {
      fecha: fmtDate(flight.fecha),
      lugar: sanitize(flight.lugar) || '-',
      horas: `${flight.horaInicioUTC ?? '--:--'} / ${flight.horaFinUTC ?? '--:--'}`,
      rpas: sanitize(`Multirrotor, ${modelo}`),
      registro: sanitize(snap.numeroDeSerie) || '-',
      tiempo: fmtHHMM(flight.duracionMinutos),
      aterrizajes: `${flight.aterrizajesDia ?? 0} / ${flight.aterrizajesNoche ?? 0}`,
      actividad: buildCodigos(flight),
      funcion: `${sanitize(flight.funcionPiloto) || 'PIC'} ${fmtHHMM(flight.duracionMinutos)}`,
      obs: sanitize(flight.observaciones) || '',
    };

    y = drawDataRow(doc, y, rowData, rowIndex % 2 === 1);
    rowIndex++;

    totals.totalMinutos += flight.duracionMinutos ?? 0;
    totals.dia += flight.aterrizajesDia ?? 0;
    totals.noche += flight.aterrizajesNoche ?? 0;
  }

  // Fila totales — nueva página si no cabe
  if (y + ROW_H > PH - MB - ROW_H - 16) {
    drawPageFooter(doc, currentPage, totalPages);
    doc.addPage();
    currentPage++;
    y = drawPageHeader(doc, currentPage);
    y = drawTableHeader(doc, y);
  }
  y = drawTotalsRow(doc, y, totals);

  drawSignatureLine(doc, y + 3);
  drawPageFooter(doc, currentPage, totalPages);

  const blob = doc.output('blob');
  const filename = `UPGES_LogBook_${new Date().toISOString().slice(0, 10)}.pdf`;
  return saveBlobAsFile(blob, filename);
}

/**
 * Exporta un único vuelo como PDF.
 */
export async function exportSingleFlightPDF(flight) {
  return exportFlightsPDF([flight]);
}