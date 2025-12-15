import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { parseCsvToItems, indexUploadedQRs, resolveWorkItems, processItemsToBlobs } from "./lib/qrWorkflow";
import "./styles/global.css";

// BLOB URL INTERCEPTOR - Detecta todas las creaciones de blob URLs
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const blobRegistry = new Map<string, { stack: string; timestamp: number }>();

URL.createObjectURL = function(blob: Blob | MediaSource): string {
  const url = originalCreateObjectURL.call(URL, blob);
  
  // Capturar stack trace (solo para debug)
  const stack = new Error().stack || 'No stack available';
  blobRegistry.set(url, { stack, timestamp: Date.now() });
  
  console.warn('🚨 BLOB URL CREATED:', url);
  console.log('📍 Stack trace:', stack);
  console.log('📦 Blob type:', blob instanceof Blob ? blob.type : 'MediaSource');
  
  // NOTA: Bloqueo removido para permitir blob URLs en producción
  // Las blob URLs son necesarias para el funcionamiento normal de la app
  
  return url;
};

URL.revokeObjectURL = function(url: string): void {
  console.log('🗑️ BLOB URL REVOKED:', url);
  if (blobRegistry.has(url)) {
    const info = blobRegistry.get(url);
    console.log('⏱️ Lifetime:', Date.now() - (info?.timestamp || 0), 'ms');
    blobRegistry.delete(url);
  }
  originalRevokeObjectURL.call(URL, url);
};

// Version checker - force reload if cached version is detected
const CURRENT_VERSION = "5.0.0";
const STORED_VERSION = localStorage.getItem("app_version");

console.log("🚀 App starting - Version:", CURRENT_VERSION);

if (STORED_VERSION && STORED_VERSION !== CURRENT_VERSION) {
  console.log("🔄 Version mismatch detected, clearing cache and reloading");
  localStorage.clear();
  sessionStorage.clear();
  // Force hard reload
  window.location.reload();
}

localStorage.setItem("app_version", CURRENT_VERSION);

const container = document.getElementById("root");

if (!container) {
  throw new Error("No se encontró el elemento raíz para inicializar la aplicación");
}

// Error boundary for any blob URL issues
window.addEventListener('error', (event) => {
  if (event.message && event.message.includes('ERR_FILE_NOT_FOUND')) {
    console.error("🚨 Blob URL error detected:", event.message);
    // Optionally force reload if too many errors
    const errorCount = parseInt(sessionStorage.getItem('blob_errors') || '0') + 1;
    sessionStorage.setItem('blob_errors', errorCount.toString());
    
    if (errorCount > 3) {
      console.log("🔄 Too many blob errors, forcing reload");
      sessionStorage.removeItem('blob_errors');
      window.location.reload();
    }
  }
});

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Exponer helpers de testing cuando se ejecuta en modo de pruebas (Puppeteer los activa con window.__TESTING__)
try {
  if ((window as any).__TESTING__) {
    (window as any).__qrTest = {
      runFullProcess: async () => {
        try {
          // Buscar inputs en la página: CSV (primer file input), QR folder (segundo), template (tercero)
          const inputs = Array.from(document.querySelectorAll('input[type=file]')) as HTMLInputElement[];
          const csvInput = inputs[0];
          const qrInput = inputs[1];
          const templateInput = inputs[2];

          const csvFile = csvInput?.files?.[0];
          const qrFiles = qrInput?.files ? Array.from(qrInput.files) : [];
          const templateFile = templateInput?.files?.[0];

          const csvItems = csvFile ? await parseCsvToItems(csvFile) : [];
          const qrIndex = qrFiles.length > 0 ? indexUploadedQRs(qrFiles as any) : new Map();
          const workItems = resolveWorkItems(csvItems.length ? csvItems : null, qrIndex);

          // Leer SVG si existe. Preferir el SVG que la UI haya vectorizado (expuesto en window.__lastVectorizedSvg)
          let svgText = null;
          if (templateFile) {
            try {
              svgText = await templateFile.text();
            } catch (e) {
              svgText = null;
            }
          }

          // Si la UI ya realizó una vectorización, usar esa versión preferente
          const lastVec = (window as any).__lastVectorizedSvg;
          const finalSvg = lastVec && typeof lastVec === 'string' ? lastVec : svgText;

          const template: any = {
            svgContent: finalSvg || undefined,
            exportFormat: 'svg',
            frame: { x: 50, y: 50, w: 100, h: 100 },
          };

          const entries = await processItemsToBlobs(workItems, qrIndex, template, {});

          // Serializar blobs a texto para retornarlos al test
          const serialized = [] as Array<{ nombre: string; text: string }>;
          for (const e of entries) {
            const txt = await e.blob.text();
            serialized.push({ nombre: e.nombre, text: txt });
          }
          return { ok: true, entries: serialized };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      }
      ,
      diagnoseLastSvg: async () => {
        try {
          // Lightweight diagnostic: inspect the uploaded template and the last UI-vectorized SVG
          const inputs = Array.from(document.querySelectorAll('input[type=file]')) as HTMLInputElement[];
          const templateInput = inputs[2];
          const templateFile = templateInput?.files?.[0];

          const parser = new DOMParser();

          // Inspect original uploaded SVG (if any)
          let original = null;
          if (templateFile) {
            try {
              const txt = await templateFile.text();
              const doc = parser.parseFromString(txt, 'image/svg+xml');
              const images = Array.from(doc.querySelectorAll('image'));
              const firstImage = images[0] as Element | undefined;
              const href = firstImage ? (firstImage.getAttribute('href') || firstImage.getAttribute('xlink:href') || '') : '';
              original = {
                hasImage: images.length > 0,
                imageCount: images.length,
                firstImageHrefSnippet: href ? href.slice(0, 120) : null,
              };
            } catch (e) {
              original = { error: 'failed to read uploaded template: ' + String(e) };
            }
          }

          // Inspect UI-vectorized SVG (if present)
          const lastVec = (window as any).__lastVectorizedSvg;
          let uiVector = null;
          if (lastVec && typeof lastVec === 'string') {
            try {
              const doc2 = parser.parseFromString(lastVec, 'image/svg+xml');
              const images2 = Array.from(doc2.querySelectorAll('image'));
              const paths2 = Array.from(doc2.querySelectorAll('path'));
              const firstImage2 = images2[0] as Element | undefined;
              const href2 = firstImage2 ? (firstImage2.getAttribute('href') || firstImage2.getAttribute('xlink:href') || '') : '';
              uiVector = {
                hasImage: images2.length > 0,
                imageCount: images2.length,
                firstImageHrefSnippet: href2 ? href2.slice(0, 120) : null,
                hasPath: paths2.length > 0,
                pathCount: paths2.length,
              };
            } catch (e) {
              uiVector = { error: 'failed to parse __lastVectorizedSvg: ' + String(e) };
            }
          }

          return { ok: true, original, uiVector };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      }
    };
    console.log('✅ Test helpers installed on window.__qrTest');
  }
} catch (e) {
  // ignore
}

