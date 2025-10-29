import React, { useMemo } from "react";
import { EmplantilladorQR } from "./components/EmplantilladorQR";
import type { TemplateDef } from "./lib/types";

function createDefaultTemplate(): TemplateDef {
  const width = 1200;
  const height = 1600;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#d0d0d0";
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, width, height);

    ctx.setLineDash([12, 8]);
    ctx.strokeStyle = "#e0e0e0";
    ctx.strokeRect(width * 0.1, height * 0.1, width * 0.8, height * 0.8);
    ctx.setLineDash([]);

    ctx.fillStyle = "#444";
    ctx.font = "48px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Vista previa de plantilla", width / 2, height * 0.08);

    ctx.font = "28px sans-serif";
    ctx.fillStyle = "#666";
    ctx.fillText("(Reemplaza esta plantilla en producción)", width / 2, height * 0.12);
  }

  // Crear imagen desde data URL en lugar de pasar el canvas directamente
  // Esto evita que el canvas cause conversiones a blob URL en dependencias
  const dataUrl = canvas.toDataURL('image/png');
  const img = new Image();
  img.src = dataUrl;

  return {
    baseImage: img,
    size: { width, height },
    frame: {
      x: width * 0.25,
      y: height * 0.2,
      w: width * 0.5,
      h: width * 0.5,
    },
    exportFormat: "png",
  };
}

export const App: React.FC = () => {
  const template = useMemo(() => createDefaultTemplate(), []);

  return (
    <div className="app-root">
      <div className="app-background">
        <div className="app-orb orb-1" />
        <div className="app-orb orb-2" />
        <div className="app-orb orb-3" />
      </div>
      <main className="app-main">
        <section className="app-surface">
          <header className="app-header">
            <span className="app-badge">Flujo líquido</span>
            <h1 className="app-title">Plantilla Auto QR</h1>
            <p className="app-description">
              Organiza y exporta tus plantillas con una interfaz inspirada en iOS: arrastra tu CSV,
              sube los códigos QR y configura la plantilla en un entorno de vidrio líquido y
              reflejos suaves.
            </p>
          </header>
          <EmplantilladorQR template={template} />
        </section>
      </main>
    </div>
  );
};

export default App;
