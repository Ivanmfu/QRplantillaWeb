import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
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

