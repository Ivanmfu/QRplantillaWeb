import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/global.css";

// Version checker - force reload if cached version is detected
const CURRENT_VERSION = "3.0.0";
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
