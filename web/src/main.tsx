import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/global.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("No se encontró el elemento raíz para inicializar la aplicación");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
