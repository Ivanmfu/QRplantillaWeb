import Papa from "papaparse";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import type {
  Frame,
  Item,
  ProcessResult,
  TemplateDef,
  UploadedQR,
  WorkItem,
} from "./types";

const DEFAULT_QR_SIZE = 512;

function normalizeNumero(numero: Item["numero"]): string {
  if (typeof numero === "number") {
    return String(numero);
  }
  return `${numero}`.trim();
}

function baseNameFromFile(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, "");
  const [beforeHyphen] = withoutExtension.split("-");
  const trimmed = beforeHyphen.trim();
  const match = trimmed.match(/^(.*?)(\d+)$/u);
  if (match) {
    const prefix = match[1].trim();
    const digits = match[2];
    if (prefix) {
      return `${prefix}-${digits}`;
    }
  }
  return trimmed;
}

function extractKeyFromFilename(name: string): string {
  const base = baseNameFromFile(name);
  const digits = base.match(/(\d+)/g);
  if (digits && digits.length > 0) {
    return digits[digits.length - 1];
  }
  return base.trim();
}

function inferExtension(fileName: string): "png" | "svg" | null {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) {
    return null;
  }
  const ext = match[1];
  if (ext === "png" || ext === "svg") {
    return ext;
  }
  return null;
}

function getSourceDimensions(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLCanvasElement) {
    return { width: source.width, height: source.height };
  }
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    return { width: source.width, height: source.height };
  }
  if (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas) {
    return { width: source.width, height: source.height };
  }
  if (source instanceof HTMLImageElement) {
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    return { width, height };
  }
  if (source instanceof SVGImageElement) {
    let width = source.width.baseVal.value || source.clientWidth;
    let height = source.height.baseVal.value || source.clientHeight;
    if ((!width || !height) && typeof source.getBBox === "function") {
      try {
        const bbox = source.getBBox();
        width = width || bbox.width;
        height = height || bbox.height;
      } catch (error) {
        // ignore failures for detached SVGs
      }
    }
    return {
      width: width || DEFAULT_QR_SIZE,
      height: height || DEFAULT_QR_SIZE,
    };
  }
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth || source.width, height: source.videoHeight || source.height };
  }
  const anySource = source as unknown as { width?: number; height?: number };
  return { width: anySource.width ?? DEFAULT_QR_SIZE, height: anySource.height ?? DEFAULT_QR_SIZE };
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function drawSourceToCanvas(source: CanvasImageSource, size: { width: number; height: number }): HTMLCanvasElement {
  const canvas = createCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("No se pudo crear el contexto 2D para el canvas de QR");
  }
  const dims = getSourceDimensions(source);
  const scale = Math.min(size.width / dims.width, size.height / dims.height);
  const drawWidth = dims.width * scale;
  const drawHeight = dims.height * scale;
  const dx = (size.width - drawWidth) / 2;
  const dy = (size.height - drawHeight) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.drawImage(source, dx, dy, drawWidth, drawHeight);
  return canvas;
}

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    // Convertir blob a data URL para evitar problemas de revocación
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        const image = new Image();
        
        image.onload = () => {
          resolve(image);
        };
        
        image.onerror = () => {
          reject(new Error("No se pudo cargar la imagen del QR subido"));
        };
        
        image.src = result;
      } else {
        reject(new Error("Error al convertir blob a data URL"));
      }
    };
    
    reader.onerror = () => {
      reject(new Error("Error al leer el archivo QR"));
    };
    
    reader.readAsDataURL(blob);
  });
}

export async function getCsvHeaders(fileOrContent: File | string): Promise<string[]> {
  const text = typeof fileOrContent === "string" ? fileOrContent : await fileOrContent.text();
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => (typeof value === "string" ? value.trim() : value),
  });
  // Prefer meta.fields (Papa) which preserves header order
  const fields = (result && (result as any).meta && (result as any).meta.fields) || Object.keys(result.data[0] || {});
  return Array.isArray(fields) ? fields.map((f) => String(f).trim()) : [];
}

export async function parseCsvToItems(
  fileOrContent: File | string,
  headerMap?: { numero?: string; enlace?: string; nombreArchivoSalida?: string }
): Promise<Item[]> {
  const text = typeof fileOrContent === "string" ? fileOrContent : await fileOrContent.text();
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => (typeof value === "string" ? value.trim() : value),
  });

  if (result.errors.length > 0) {
    const firstError = result.errors[0];
    throw new Error(`Error al leer CSV: ${firstError.message}`);
  }

  const items: Item[] = [];
  // determine which csv keys to use for each semantic field
  const possibleNumero = headerMap?.numero || "numero";
  const possibleEnlace = headerMap?.enlace || "enlace";
  const possibleNombre = headerMap?.nombreArchivoSalida || "nombreArchivoSalida";

  for (const row of result.data) {
    const numeroRaw = (row as any)[possibleNumero] ?? "";
    const enlace = (row as any)[possibleEnlace] ?? "";
    const nombreArchivoSalidaRaw = (row as any)[possibleNombre] ?? "";
    const numeroTrim = typeof numeroRaw === "string" ? numeroRaw.trim() : `${numeroRaw}`.trim();
    if (!numeroTrim) {
      console.warn("Fila ignorada: falta el campo 'numero'", row);
      continue;
    }
    const isInteger = /^-?\d+$/.test(numeroTrim);
    const hasLeadingZeros = /^-?0\d+/.test(numeroTrim);
    const numeroValue = isInteger && !hasLeadingZeros ? Number(numeroTrim) : numeroTrim;
    
    // Si nombreArchivoSalida está vacío, usar el numero como nombre de salida
    const nombreArchivoSalidaTrim = typeof nombreArchivoSalidaRaw === "string" 
      ? nombreArchivoSalidaRaw.trim() 
      : `${nombreArchivoSalidaRaw}`.trim();
    const nombreArchivoSalida = nombreArchivoSalidaTrim || numeroTrim;
    
    items.push({
      numero: numeroValue,
      enlace,
      nombreArchivoSalida,
    });
  }

  return items;
}

export function createTemplateCsv(headers?: string[]): string {
  const h = headers && headers.length > 0 ? headers : ["numero", "enlace", "nombreArchivoSalida"];
  // example row with placeholders
  const example = h.map((key) => (key === "numero" ? "123" : key === "enlace" ? "https://example.com" : "nombre-salida")).join(",");
  return `${h.join(",")}\n${example}\n`;
}

export function indexUploadedQRs(files: FileList | File[]): Map<string, UploadedQR> {
  const list: File[] = files instanceof FileList ? Array.from(files) : files;
  const map = new Map<string, UploadedQR>();
  for (const file of list) {
    const ext = inferExtension(file.name);
    if (!ext) {
      console.warn(`Archivo ignorado (extensión no soportada): ${file.name}`);
      continue;
    }
    const key = extractKeyFromFilename(file.name);
    if (map.has(key)) {
      console.warn(`QR duplicado para '${key}' - se conserva el primero`);
      continue;
    }
    const baseName = baseNameFromFile(file.name).trim() || key;
    map.set(key, { key, blob: file, ext, fileName: file.name, baseName });
  }
  return map;
}

export function resolveWorkItems(
  csvItems: Item[] | null,
  qrIndex: Map<string, UploadedQR>
): WorkItem[] {
  const workItems: WorkItem[] = [];
  if (csvItems && csvItems.length > 0) {
    const seen = new Set<string>();
    for (const item of csvItems) {
      const numeroKey = normalizeNumero(item.numero);
      if (!numeroKey) {
        console.warn("Elemento ignorado por falta de numero", item);
        continue;
      }
      if (seen.has(numeroKey)) {
        console.warn(`Numero duplicado '${numeroKey}' encontrado en CSV. Se usa la primera aparición.`);
        continue;
      }
      seen.add(numeroKey);
      const existing = qrIndex.get(numeroKey);
      const nombreArchivoSalida =
        item.nombreArchivoSalida?.trim() || existing?.baseName || numeroKey;
      workItems.push({
        ...item,
        nombreArchivoSalida,
        origenQR: existing ? "subido" : "generado",
        qrFileName: existing?.fileName,
      });
    }
  } else {
    qrIndex.forEach((uploaded) => {
      workItems.push({
        numero: uploaded.key,
        enlace: "",
        nombreArchivoSalida: uploaded.baseName,
        origenQR: "subido",
        qrFileName: uploaded.fileName,
      });
    });
  }
  return workItems;
}

function prettifyLabelText(source: string): string {
  return source
    .replace(/[_-]+/g, " ")
    .replace(/(?<=\D)(?=\d)|(?<=\d)(?=\D)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function rasterizeUploadedQR(uploaded: UploadedQR, size: number): Promise<HTMLCanvasElement> {
  if (uploaded.ext === "svg") {
    const image = await loadImageFromBlob(uploaded.blob);
    return drawSourceToCanvas(image, { width: size, height: size });
  }
  const image = await loadImageFromBlob(uploaded.blob);
  return drawSourceToCanvas(image, { width: size, height: size });
}

export async function generateQRCanvas(url: string, sizePx: number = DEFAULT_QR_SIZE): Promise<HTMLCanvasElement> {
  if (!url) {
    throw new Error("No se puede generar un QR sin enlace");
  }
  const canvas = createCanvas(sizePx, sizePx);
  await QRCode.toCanvas(canvas, url, {
    errorCorrectionLevel: "M",
    margin: 0,
    color: {
      dark: "#000000",
      light: "#00000000",
    },
    width: sizePx,
  });
  return canvas;
}

export async function getQRForItem(
  item: Item,
  qrIndex: Map<string, UploadedQR>,
  sizePx: number = DEFAULT_QR_SIZE
): Promise<HTMLCanvasElement> {
  const numeroKey = normalizeNumero(item.numero);
  const uploaded = numeroKey ? qrIndex.get(numeroKey) : undefined;
  if (uploaded) {
    return rasterizeUploadedQR(uploaded, sizePx);
  }
  if (!item.enlace) {
    throw new Error(`No se encontró QR para ${numeroKey} y falta enlace para generarlo`);
  }
  return generateQRCanvas(item.enlace, sizePx);
}

export function prepareTemplateForItem(template: TemplateDef, item: Item): TemplateDef {
  if (!template.labelBox) {
    return template;
  }
  
  // Siempre usar el nombreArchivoSalida del item específico para la etiqueta
  // Esto asegura que cada item tenga su propio texto único
  const nombre = item.nombreArchivoSalida?.trim();
  const fallback = nombre && nombre.length > 0 ? nombre : normalizeNumero(item.numero);
  const prettified = prettifyLabelText(fallback);
  
  // Siempre crear una nueva plantilla con el texto del item actual
  return { ...template, labelText: prettified };
}

export function placeQROnTemplate(
  qr: CanvasImageSource,
  templateCanvas: HTMLCanvasElement,
  frame: Frame
): void {
  const ctx = templateCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("No se pudo obtener el contexto 2D de la plantilla");
  }
  
  // Usar las dimensiones exactas del frame sin centrar
  const dx = frame.x;
  const dy = frame.y;
  const drawWidth = frame.w;
  const drawHeight = frame.h;
  
  // QR positioning logs cleaned
  
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(qr, dx, dy, drawWidth, drawHeight);
  ctx.restore();
}

function drawTemplateBase(canvas: HTMLCanvasElement, template: TemplateDef): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("No se pudo inicializar el canvas de la plantilla");
  }
  const source = template.baseImage;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Dibujar la imagen base manteniendo las dimensiones exactas
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
}

export async function renderItem(
  item: Item,
  qrIndex: Map<string, UploadedQR>,
  templateDef: TemplateDef,
  options?: {
    textColor?: string;
    isTransparentBackground?: boolean;
    fontSize?: number;
    isBold?: boolean;
  }
): Promise<HTMLCanvasElement> {
  const baseDims = templateDef.size ?? getSourceDimensions(templateDef.baseImage);
  const canvas = createCanvas(baseDims.width, baseDims.height);
  
  console.log('🎯 EXPORT: Canvas size:', { width: canvas.width, height: canvas.height });
  console.log('🎯 EXPORT: QR frame:', templateDef.frame);
  console.log('🎯 EXPORT: Label box:', templateDef.labelBox);
  
  drawTemplateBase(canvas, templateDef);
  const qrSize = Math.round(Math.max(templateDef.frame.w, templateDef.frame.h));
  const qrCanvas = await getQRForItem(item, qrIndex, qrSize);
  placeQROnTemplate(qrCanvas, canvas, templateDef.frame);
  // draw label if provided
  if (templateDef.labelBox && templateDef.labelText) {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const lb = templateDef.labelBox;
      ctx.save();
      
      // draw background for label only if not transparent
      if (!options?.isTransparentBackground) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(lb.x, lb.y, lb.w, lb.h);
      }
      
      // draw text with user preferences
      const fontSize = options?.fontSize ?? Math.max(10, Math.floor(lb.h * 0.6));
      
      // Convert hex color to RGB if provided
      let textColor = "#000000"; // default black
      if (options?.textColor) {
        textColor = options.textColor;
      }
      
      ctx.fillStyle = textColor;
      const fontWeight = options?.isBold ? "bold" : "normal";
      ctx.font = `${fontWeight} ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const textX = lb.x + lb.w / 2;
      const textY = lb.y + lb.h / 2;
      
      // Text positioning logs cleaned
      
      // clip to label width
      const maxWidth = Math.max(10, lb.w - 8);
      ctx.fillText(templateDef.labelText, textX, textY, maxWidth);
      ctx.restore();
    }
  }
  return canvas;
}

export async function exportItem(
  canvas: HTMLCanvasElement,
  nombreArchivoSalida: string,
  formato: "png" | "pdf"
): Promise<Blob> {
  if (formato === "png") {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) {
          resolve(value);
        } else {
          reject(new Error("No se pudo generar el PNG"));
        }
      }, "image/png");
    });
    return blob;
  }

  const orientation = canvas.width >= canvas.height ? "landscape" : "portrait";
  const pdf = new jsPDF({
    orientation,
    unit: "pt",
    format: [canvas.width, canvas.height],
  });
  const dataUrl = canvas.toDataURL("image/png");
  pdf.addImage(dataUrl, "PNG", 0, 0, canvas.width, canvas.height);
  return pdf.output("blob");
}

export async function processItems(
  items: WorkItem[],
  qrIndex: Map<string, UploadedQR>,
  template: TemplateDef,
  options?: {
    textColor?: string;
    isTransparentBackground?: boolean;
    fontSize?: number;
    isBold?: boolean;
  }
): Promise<ProcessResult[]> {
  const results: ProcessResult[] = [];
  for (const item of items) {
    try {
      const templateForItem = prepareTemplateForItem(template, item);
      const canvas = await renderItem(item, qrIndex, templateForItem, options);
      const formato = templateForItem.exportFormat ?? "png";
      const blob = await exportItem(canvas, item.nombreArchivoSalida, formato);
      triggerDownload(blob, item.nombreArchivoSalida, formato);
      results.push({ item, resultado: "ok" });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      console.error(mensaje, error);
      results.push({ item, resultado: "error", mensaje });
    }
  }
  return results;
}

/**
 * Procesa los elementos y devuelve un array de { nombre, blob } sin iniciar descarga.
 */
export async function processItemsToBlobs(
  items: WorkItem[],
  qrIndex: Map<string, UploadedQR>,
  template: TemplateDef,
  options?: {
    textColor?: string;
    isTransparentBackground?: boolean;
    fontSize?: number;
    isBold?: boolean;
  }
): Promise<Array<{ nombre: string; blob: Blob }>> {
  const out: Array<{ nombre: string; blob: Blob }> = [];
  for (const item of items) {
    try {
      const templateForItem = prepareTemplateForItem(template, item);
      const canvas = await renderItem(item, qrIndex, templateForItem, options);
      const formato = templateForItem.exportFormat ?? "png";
      const blob = await exportItem(canvas, item.nombreArchivoSalida, formato);
      out.push({ nombre: `${item.nombreArchivoSalida}.${formato}`, blob });
    } catch (error) {
      // skip errored items; caller puede manejar logging
      console.error(error);
    }
  }
  return out;
}

export async function createZipFromBlobs(entries: Array<{ nombre: string; blob: Blob }>): Promise<Blob> {
  const zip = new JSZip();
  for (const e of entries) {
    zip.file(e.nombre, e.blob);
  }
  const content = await zip.generateAsync({ type: "blob" });
  return content;
}

/**
 * Genera un PDF con marcas de corte y sangrado (3mm) para impresión profesional.
 * Mantiene la relación exacta píxel-a-milímetro usando conversión estándar de impresión.
 * 
 * Conversión estándar de impresión:
 * - 1 pulgada = 25.4 mm
 * - 1 pulgada = 72 puntos (pt) en PDF
 * - Por tanto: 1 mm = 2.83465 pt
 * - Para imágenes a 72 DPI: 1 píxel = 1 punto = 0.3528 mm
 * 
 * @param items - Array de items a exportar
 * @param qrIndex - Índice de códigos QR subidos
 * @param template - Definición de la plantilla
 * @param options - Opciones de renderizado
 * @returns Blob del PDF generado
 */
export async function exportPrintPDF(
  items: WorkItem[],
  qrIndex: Map<string, UploadedQR>,
  template: TemplateDef,
  options?: {
    textColor?: string;
    isTransparentBackground?: boolean;
    fontSize?: number;
    isBold?: boolean;
  }
): Promise<Blob> {
  // Constantes de conversión
  const MM_TO_PT = 2.83465; // 1 mm = 2.83465 puntos
  const CROP_MARK_LENGTH_MM = 2; // marcas de corte de 2mm
  const CROP_MARK_OFFSET_MM = 1; // separación de 1mm entre imagen y marcas
  
  // Renderizar el primer item para obtener las dimensiones
  const firstTemplateForItem = prepareTemplateForItem(template, items[0]);
  const firstCanvas = await renderItem(items[0], qrIndex, firstTemplateForItem, options);
  
  // Conversión correcta: 827px = 70mm → 1px = 0.08464mm (aprox. 300 DPI)
  // La imagen YA incluye el sangrado de 3mm, así que no lo añadimos
  const PX_TO_MM = 70 / 827; // Relación específica para estas plantillas
  const designWidthMM = firstCanvas.width * PX_TO_MM;
  const designHeightMM = firstCanvas.height * PX_TO_MM;
  
  // Dimensiones totales de página (imagen + 3mm por lado para marcas = 76mm total)
  const pageWidthMM = designWidthMM + (2 * (CROP_MARK_LENGTH_MM + CROP_MARK_OFFSET_MM));
  const pageHeightMM = designHeightMM + (2 * (CROP_MARK_LENGTH_MM + CROP_MARK_OFFSET_MM));
  
  // Convertir a puntos para jsPDF
  const pageWidthPt = pageWidthMM * MM_TO_PT;
  const pageHeightPt = pageHeightMM * MM_TO_PT;
  const cropMarkLengthPt = CROP_MARK_LENGTH_MM * MM_TO_PT;
  const cropMarkOffsetPt = CROP_MARK_OFFSET_MM * MM_TO_PT;
  const designWidthPt = designWidthMM * MM_TO_PT;
  const designHeightPt = designHeightMM * MM_TO_PT;
  
  console.log('📄 PDF SIZE CALCULATION:');
  console.log('  Image:', firstCanvas.width, 'x', firstCanvas.height, 'px');
  console.log('  Design (with bleed):', designWidthMM.toFixed(2), 'x', designHeightMM.toFixed(2), 'mm');
  console.log('  + Marks (5mm+2mm):', pageWidthMM.toFixed(2), 'x', pageHeightMM.toFixed(2), 'mm');
  
  // Crear el PDF
  const pdf = new jsPDF({
    orientation: pageWidthPt >= pageHeightPt ? "landscape" : "portrait",
    unit: "pt",
    format: [pageWidthPt, pageHeightPt],
  });
  
  let isFirstPage = true;
  
  for (const item of items) {
    try {
      if (!isFirstPage) {
        pdf.addPage([pageWidthPt, pageHeightPt]);
      }
      isFirstPage = false;
      
      const templateForItem = prepareTemplateForItem(template, item);
      const canvas = await renderItem(item, qrIndex, templateForItem, options);
      const dataUrl = canvas.toDataURL("image/png");
      
      // Posición de la imagen: centrada con espacio para marcas
      const imageX = cropMarkLengthPt + cropMarkOffsetPt;
      const imageY = cropMarkLengthPt + cropMarkOffsetPt;
      
      // Dibujar la imagen en su tamaño real
      pdf.addImage(
        dataUrl,
        "PNG",
        imageX,
        imageY,
        designWidthPt,
        designHeightPt
      );
      
      // Dibujar marcas de corte
      pdf.setDrawColor(0, 0, 0);
      pdf.setLineWidth(0.5);
      
      // Coordenadas del área de corte final (borde de la imagen sin sangrado)
      const cropLeft = imageX;
      const cropRight = imageX + designWidthPt;
      const cropTop = imageY;
      const cropBottom = imageY + designHeightPt;
      
      // Marcas de corte en las 4 esquinas
      // Esquina superior izquierda
      pdf.line(
        cropLeft - cropMarkOffsetPt - cropMarkLengthPt,
        cropTop,
        cropLeft - cropMarkOffsetPt,
        cropTop
      ); // horizontal
      pdf.line(
        cropLeft,
        cropTop - cropMarkOffsetPt - cropMarkLengthPt,
        cropLeft,
        cropTop - cropMarkOffsetPt
      ); // vertical
      
      // Esquina superior derecha
      pdf.line(
        cropRight + cropMarkOffsetPt,
        cropTop,
        cropRight + cropMarkOffsetPt + cropMarkLengthPt,
        cropTop
      ); // horizontal
      pdf.line(
        cropRight,
        cropTop - cropMarkOffsetPt - cropMarkLengthPt,
        cropRight,
        cropTop - cropMarkOffsetPt
      ); // vertical
      
      // Esquina inferior izquierda
      pdf.line(
        cropLeft - cropMarkOffsetPt - cropMarkLengthPt,
        cropBottom,
        cropLeft - cropMarkOffsetPt,
        cropBottom
      ); // horizontal
      pdf.line(
        cropLeft,
        cropBottom + cropMarkOffsetPt,
        cropLeft,
        cropBottom + cropMarkOffsetPt + cropMarkLengthPt
      ); // vertical
      
      // Esquina inferior derecha
      pdf.line(
        cropRight + cropMarkOffsetPt,
        cropBottom,
        cropRight + cropMarkOffsetPt + cropMarkLengthPt,
        cropBottom
      ); // horizontal
      pdf.line(
        cropRight,
        cropBottom + cropMarkOffsetPt,
        cropRight,
        cropBottom + cropMarkOffsetPt + cropMarkLengthPt
      ); // vertical
      
    } catch (error) {
      console.error(`Error procesando item para PDF de impresión:`, error);
    }
  }
  
  return pdf.output("blob");
}

function triggerDownload(blob: Blob, nombre: string, formato: "png" | "pdf"): void {
  const extension = formato === "png" ? ".png" : ".pdf";
  
  // Usar FileReader para convertir a data URL
  const reader = new FileReader();
  reader.onload = function() {
    const dataUrl = reader.result as string;
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `${nombre}${extension}`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };
  reader.readAsDataURL(blob);
}
