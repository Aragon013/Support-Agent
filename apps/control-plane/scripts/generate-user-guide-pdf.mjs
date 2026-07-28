#!/usr/bin/env node
/**
 * Genera un PDF a partir de docs/USER_GUIDE.md usando pdfkit.
 * Soporta un subconjunto de Markdown: # ## ###, párrafos, listas "-",
 * listas numeradas, bloques de código ``` y tablas con pipes.
 *
 * Uso (desde apps/control-plane para resolver pdfkit):
 *   node scripts/generate-user-guide-pdf.mjs
 */
import PDFDocument from "pdfkit";
import { createWriteStream, readFileSync, renameSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");
// Argumentos opcionales: node generate-user-guide-pdf.mjs [entrada.md] [salida.pdf]
const argIn = process.argv[2];
const argOut = process.argv[3];
const inputPath = argIn ? (argIn.includes("\\") || argIn.includes("/") ? argIn : join(repoRoot, "docs", argIn)) : join(repoRoot, "docs", "USER_GUIDE.md");
const outputPath = argOut ? (argOut.includes("\\") || argOut.includes("/") ? argOut : join(repoRoot, "docs", argOut)) : join(repoRoot, "docs", "USER_GUIDE.pdf");
const tmpPath = `${outputPath}.tmp`;

const md = readFileSync(inputPath, "utf8");
const lines = md.split(/\r?\n/);

// ── Colores / estilo ────────────────────────────────────────────────────────
const BRAND = "#0b84ff";
const INK = "#1e293b";
const MUTED = "#64748b";
const TABLE_HEAD_BG = "#eef4ff";
const TABLE_BORDER = "#cbd5e1";
const CODE_BG = "#f1f5f9";

const stream = createWriteStream(tmpPath);
const doc = new PDFDocument({ size: "A4", margin: 48 });
doc.pipe(stream);

stream.on("finish", () => {
  try {
    if (existsSync(outputPath)) unlinkSync(outputPath);
    renameSync(tmpPath, outputPath);
    console.log(`[guide-pdf] PDF generado en: ${outputPath}`);
  } catch (err) {
    if (err && err.code === "EBUSY") {
      console.error(`[guide-pdf] No se pudo reemplazar el PDF: está ABIERTO en un lector.`);
      console.error(`[guide-pdf] Ciérralo y vuelve a ejecutar. La versión nueva quedó en: ${tmpPath}`);
    } else {
      throw err;
    }
  }
});

const LEFT = doc.page.margins.left;
const RIGHT = doc.page.width - doc.page.margins.right;
const CONTENT_W = RIGHT - LEFT;

function ensureSpace(h) {
  if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function h1(text) {
  ensureSpace(40);
  doc.moveDown(0.3);
  doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(22).text(text, LEFT, doc.y, { width: CONTENT_W });
  const y = doc.y + 4;
  doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(2).strokeColor(BRAND).stroke();
  doc.moveDown(0.8);
}

function h2(text) {
  ensureSpace(30);
  doc.moveDown(0.5);
  doc.x = LEFT;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(text, LEFT, doc.y, { width: CONTENT_W });
  doc.moveDown(0.3);
}

function h3(text) {
  ensureSpace(24);
  doc.moveDown(0.3);
  doc.x = LEFT;
  doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(12).text(text, LEFT, doc.y, { width: CONTENT_W });
  doc.moveDown(0.2);
}

function paragraph(text) {
  ensureSpace(20);
  doc.x = LEFT;
  doc.fillColor(INK).font("Helvetica").fontSize(10.5).text(text, LEFT, doc.y, { width: CONTENT_W, align: "left", lineGap: 2 });
  doc.moveDown(0.4);
}

function bullet(text, ordered, index) {
  const marker = ordered ? `${index}.` : "•";
  ensureSpace(18);
  const startX = LEFT + 12;
  const y = doc.y;
  doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(10.5).text(marker, LEFT, y, { width: 12, continued: false });
  doc.fillColor(INK).font("Helvetica").fontSize(10.5).text(text, startX + 4, y, { width: CONTENT_W - 16, lineGap: 1 });
  doc.x = LEFT;
  doc.moveDown(0.2);
}

function codeBlock(codeLines) {
  const pad = 8;
  doc.font("Courier").fontSize(9.5);
  const innerW = CONTENT_W - pad * 2;
  let h = pad * 2;
  for (const l of codeLines) h += doc.heightOfString(l || " ", { width: innerW });
  ensureSpace(h + 6);
  const top = doc.y;
  doc.save().rect(LEFT, top, CONTENT_W, h).fill(CODE_BG).restore();
  let y = top + pad;
  for (const l of codeLines) {
    doc.fillColor("#0f172a").font("Courier").fontSize(9.5).text(l || " ", LEFT + pad, y, { width: innerW });
    y = doc.y;
  }
  doc.x = LEFT;
  doc.y = top + h;
  doc.moveDown(0.5);
}

function table(headers, rows) {
  const cols = headers.length;
  // Pesos por longitud de contenido (encabezado + celdas), acotado.
  const weights = headers.map((hd, i) => {
    let maxLen = hd.length;
    for (const r of rows) maxLen = Math.max(maxLen, (r[i] ?? "").length);
    return Math.min(Math.max(maxLen, 6), 46);
  });
  const totalW = weights.reduce((a, b) => a + b, 0);
  const colW = weights.map((w) => (w / totalW) * CONTENT_W);
  const pad = 5;

  const rowHeight = (cells, font, size) => {
    doc.font(font).fontSize(size);
    let max = 0;
    cells.forEach((c, i) => {
      const hh = doc.heightOfString(c ?? "", { width: colW[i] - pad * 2 });
      if (hh > max) max = hh;
    });
    return max + pad * 2;
  };

  const drawRow = (cells, font, size, bg) => {
    const h = rowHeight(cells, font, size);
    ensureSpace(h);
    const top = doc.y;
    if (bg) doc.save().rect(LEFT, top, CONTENT_W, h).fill(bg).restore();
    let x = LEFT;
    cells.forEach((c, i) => {
      doc.fillColor(INK).font(font).fontSize(size).text(c ?? "", x + pad, top + pad, { width: colW[i] - pad * 2 });
      x += colW[i];
    });
    // Bordes
    doc.strokeColor(TABLE_BORDER).lineWidth(0.5);
    doc.moveTo(LEFT, top).lineTo(RIGHT, top).stroke();
    doc.moveTo(LEFT, top + h).lineTo(RIGHT, top + h).stroke();
    x = LEFT;
    for (let i = 0; i <= cols; i++) {
      doc.moveTo(x, top).lineTo(x, top + h).stroke();
      x += colW[i] ?? 0;
    }
    doc.y = top + h;
  };

  doc.moveDown(0.2);
  drawRow(headers, "Helvetica-Bold", 9.5, TABLE_HEAD_BG);
  for (const r of rows) drawRow(r, "Helvetica", 9.5, null);
  doc.moveDown(0.6);
}

// ── Parser línea por línea ──────────────────────────────────────────────────
function parseTableCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

let i = 0;
while (i < lines.length) {
  const line = lines[i];

  // Código
  if (line.trim().startsWith("```")) {
    const buf = [];
    i++;
    while (i < lines.length && !lines[i].trim().startsWith("```")) {
      buf.push(lines[i]);
      i++;
    }
    i++; // cierre
    codeBlock(buf);
    continue;
  }

  // Tabla
  if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
    const headers = parseTableCells(line);
    i += 2; // saltar separador
    const rows = [];
    while (i < lines.length && lines[i].trim().startsWith("|")) {
      rows.push(parseTableCells(lines[i]));
      i++;
    }
    table(headers, rows);
    continue;
  }

  if (line.startsWith("### ")) { h3(line.slice(4)); i++; continue; }
  if (line.startsWith("## ")) { h2(line.slice(3)); i++; continue; }
  if (line.startsWith("# ")) { h1(line.slice(2)); i++; continue; }

  // Lista con viñetas
  if (/^\s*-\s+/.test(line)) {
    bullet(line.replace(/^\s*-\s+/, ""), false, 0);
    i++;
    continue;
  }
  // Lista numerada
  const numMatch = line.match(/^\s*(\d+)\.\s+(.*)/);
  if (numMatch) {
    bullet(numMatch[2], true, Number(numMatch[1]));
    i++;
    continue;
  }

  if (line.trim() === "") { i++; continue; }

  paragraph(line.trim());
  i++;
}

doc.end();
