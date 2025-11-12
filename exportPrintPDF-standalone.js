/**
 * FUNCIÓN STANDALONE PARA EXPORTAR IMAGEN A PDF CON MARCAS DE CORTE
 * 
 * Exporta una imagen (HTMLCanvasElement o Image) a PDF manteniendo la relación
 * exacta píxel-a-milímetro, añadiendo sangrado de 3mm y marcas de corte.
 * 
 * Requiere: jsPDF 3.x
 * 
 * CONVERSIÓN ESTÁNDAR DE IMPRESIÓN:
 * - 1 pulgada = 25.4 mm
 * - 1 pulgada = 72 puntos (pt) en PDF
 * - Por tanto: 1 mm = 2.83465 pt
 * - Para imágenes a 72 DPI: 1 píxel = 1 punto = 0.3528 mm
 * 
 * EJEMPLO DE USO:
 * 
 * ```javascript
 * import { jsPDF } from 'jspdf';
 * 
 * // Desde un canvas
 * const canvas = document.getElementById('myCanvas');
 * const pdfBlob = await exportImageToPrintPDF(canvas);
 * 
 * // Desde una imagen
 * const img = new Image();
 * img.src = 'path/to/image.png';
 * await img.decode();
 * const pdfBlob = await exportImageToPrintPDF(img);
 * 
 * // Descargar el PDF
 * const url = URL.createObjectURL(pdfBlob);
 * const a = document.createElement('a');
 * a.href = url;
 * a.download = 'print-ready.pdf';
 * a.click();
 * ```
 */

/**
 * Exporta una imagen a PDF con marcas de corte y sangrado para impresión profesional
 * 
 * @param {HTMLCanvasElement|HTMLImageElement} source - Canvas o imagen a exportar
 * @param {Object} options - Opciones de configuración
 * @param {number} [options.bleedMM=3] - Sangrado en milímetros (por defecto 3mm)
 * @param {number} [options.cropMarkLengthPT=20] - Longitud de marcas de corte en puntos
 * @param {number} [options.cropMarkOffsetPT=10] - Separación entre sangrado y marcas en puntos
 * @param {number} [options.cropMarkWidth=0.5] - Grosor de las marcas de corte en puntos
 * @param {string} [options.imageFormat='PNG'] - Formato de imagen (PNG, JPEG)
 * @param {number} [options.imageQuality=1.0] - Calidad de imagen (0.0 a 1.0, solo para JPEG)
 * @returns {Promise<Blob>} Blob del PDF generado
 */
async function exportImageToPrintPDF(source, options = {}) {
  // Opciones por defecto
  const {
    bleedMM = 3,
    cropMarkLengthPT = 20,
    cropMarkOffsetPT = 10,
    cropMarkWidth = 0.5,
    imageFormat = 'PNG',
    imageQuality = 1.0
  } = options;

  // Constantes de conversión
  const MM_TO_PT = 2.83465; // 1 mm = 2.83465 puntos
  const PX_TO_PT = 1; // A 72 DPI, 1 píxel = 1 punto
  
  // Convertir sangrado a puntos
  const bleedPt = bleedMM * MM_TO_PT;

  // Obtener dimensiones de la imagen fuente
  let imageWidthPx, imageHeightPx, dataUrl;
  
  if (source instanceof HTMLCanvasElement) {
    // Si es un canvas, obtener dimensiones directamente
    imageWidthPx = source.width;
    imageHeightPx = source.height;
    dataUrl = source.toDataURL(`image/${imageFormat.toLowerCase()}`, imageQuality);
  } else if (source instanceof HTMLImageElement) {
    // Si es una imagen, usar naturalWidth/naturalHeight
    imageWidthPx = source.naturalWidth;
    imageHeightPx = source.naturalHeight;
    
    // Convertir imagen a data URL usando un canvas temporal
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imageWidthPx;
    tempCanvas.height = imageHeightPx;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(source, 0, 0);
    dataUrl = tempCanvas.toDataURL(`image/${imageFormat.toLowerCase()}`, imageQuality);
  } else {
    throw new Error('Source must be HTMLCanvasElement or HTMLImageElement');
  }

  // Convertir dimensiones de píxeles a puntos (relación 1:1 a 72 DPI)
  const imageWidthPt = imageWidthPx * PX_TO_PT;
  const imageHeightPt = imageHeightPx * PX_TO_PT;

  // Dimensiones del área de corte (imagen + sangrado)
  const trimBoxWidthPt = imageWidthPt + (2 * bleedPt);
  const trimBoxHeightPt = imageHeightPt + (2 * bleedPt);

  // Dimensiones totales de la página (incluyendo espacio para marcas de corte)
  const pageWidthPt = trimBoxWidthPt + (2 * (cropMarkLengthPT + cropMarkOffsetPT));
  const pageHeightPt = trimBoxHeightPt + (2 * (cropMarkLengthPT + cropMarkOffsetPT));

  // Crear el PDF
  const pdf = new jsPDF({
    orientation: pageWidthPt >= pageHeightPt ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [pageWidthPt, pageHeightPt],
  });

  // Posición de la imagen (centrada con espacio para marcas y sangrado)
  const imageX = cropMarkLengthPT + cropMarkOffsetPT + bleedPt;
  const imageY = cropMarkLengthPT + cropMarkOffsetPT + bleedPt;

  // Dibujar la imagen en su tamaño real (píxel = punto)
  pdf.addImage(
    dataUrl,
    imageFormat,
    imageX,
    imageY,
    imageWidthPt,
    imageHeightPt
  );

  // Configurar estilo de las marcas de corte
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(cropMarkWidth);

  // Coordenadas del área de corte final (borde de la imagen sin sangrado)
  // Las marcas indican dónde cortar para eliminar el sangrado
  const cropLeft = imageX;
  const cropRight = imageX + imageWidthPt;
  const cropTop = imageY;
  const cropBottom = imageY + imageHeightPt;

  // Marcas de corte en las 4 esquinas
  // Cada esquina tiene una marca horizontal y una vertical

  // Esquina superior izquierda
  pdf.line(
    cropLeft - cropMarkOffsetPT - cropMarkLengthPT,
    cropTop,
    cropLeft - cropMarkOffsetPT,
    cropTop
  ); // horizontal
  pdf.line(
    cropLeft,
    cropTop - cropMarkOffsetPT - cropMarkLengthPT,
    cropLeft,
    cropTop - cropMarkOffsetPT
  ); // vertical

  // Esquina superior derecha
  pdf.line(
    cropRight + cropMarkOffsetPT,
    cropTop,
    cropRight + cropMarkOffsetPT + cropMarkLengthPT,
    cropTop
  ); // horizontal
  pdf.line(
    cropRight,
    cropTop - cropMarkOffsetPT - cropMarkLengthPT,
    cropRight,
    cropTop - cropMarkOffsetPT
  ); // vertical

  // Esquina inferior izquierda
  pdf.line(
    cropLeft - cropMarkOffsetPT - cropMarkLengthPT,
    cropBottom,
    cropLeft - cropMarkOffsetPT,
    cropBottom
  ); // horizontal
  pdf.line(
    cropLeft,
    cropBottom + cropMarkOffsetPT,
    cropLeft,
    cropBottom + cropMarkOffsetPT + cropMarkLengthPT
  ); // vertical

  // Esquina inferior derecha
  pdf.line(
    cropRight + cropMarkOffsetPT,
    cropBottom,
    cropRight + cropMarkOffsetPT + cropMarkLengthPT,
    cropBottom
  ); // horizontal
  pdf.line(
    cropRight,
    cropBottom + cropMarkOffsetPT,
    cropRight,
    cropBottom + cropMarkOffsetPT + cropMarkLengthPT
  ); // vertical

  // Retornar el PDF como Blob
  return pdf.output('blob');
}

/**
 * EJEMPLO COMPLETO DE USO EN NAVEGADOR:
 * 
 * <!DOCTYPE html>
 * <html>
 * <head>
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
 * </head>
 * <body>
 *   <canvas id="myCanvas" width="265" height="265"></canvas>
 *   <button onclick="exportToPDF()">Exportar a PDF</button>
 *   
 *   <script>
 *     // Dibujar algo en el canvas
 *     const canvas = document.getElementById('myCanvas');
 *     const ctx = canvas.getContext('2d');
 *     ctx.fillStyle = 'red';
 *     ctx.fillRect(0, 0, 265, 265);
 *     ctx.fillStyle = 'white';
 *     ctx.font = '40px Arial';
 *     ctx.fillText('Test', 100, 140);
 *     
 *     async function exportToPDF() {
 *       const { jsPDF } = window.jspdf;
 *       
 *       // Copiar la función exportImageToPrintPDF aquí...
 *       
 *       const pdfBlob = await exportImageToPrintPDF(canvas, {
 *         bleedMM: 3,
 *         cropMarkLengthPT: 20,
 *         imageFormat: 'PNG'
 *       });
 *       
 *       // Descargar
 *       const url = URL.createObjectURL(pdfBlob);
 *       const a = document.createElement('a');
 *       a.href = url;
 *       a.download = 'print-ready.pdf';
 *       a.click();
 *       URL.revokeObjectURL(url);
 *     }
 *   </script>
 * </body>
 * </html>
 */

/**
 * CÁLCULOS DE EJEMPLO PARA VERIFICACIÓN:
 * 
 * Imagen de 265x265 píxeles:
 * - Imagen en puntos: 265pt x 265pt
 * - Imagen en mm: 93.45mm x 93.45mm (265 ÷ 2.83465)
 * - Sangrado: 3mm = 8.5pt por lado
 * - Área con sangrado: 282pt x 282pt (265 + 2×8.5)
 * - Marcas de corte: 20pt de largo, 10pt de separación
 * - Página total: 342pt x 342pt (282 + 2×(20+10))
 * - Página en mm: 120.65mm x 120.65mm
 * 
 * El resultado en el PDF:
 * - Tamaño de página: 319×319mm (cuadrada)
 * - Al imprimir, cortar por las marcas dejará: 93.45×93.45mm
 * - Coincide exactamente con 265px convertidos a mm
 */

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { exportImageToPrintPDF };
}

// Exportar para uso en ES6
if (typeof window !== 'undefined') {
  window.exportImageToPrintPDF = exportImageToPrintPDF;
}
