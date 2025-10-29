export type Item = {
  numero: number | string;
  enlace: string;
  nombreArchivoSalida: string;
};

export type UploadedQR = {
  key: string;
  blob: Blob;
  ext: "png" | "svg";
  /** Nombre de archivo original, incluyendo la extensión. */
  fileName: string;
  /** Nombre base sin extensión, útil para etiquetar y exportar. */
  baseName: string;
};

export type OrigenQR = "subido" | "generado";

export type WorkItem = Item & {
  origenQR: OrigenQR;
  /** Nombre del archivo QR original (si viene de una carpeta cargada). */
  qrFileName?: string;
};

export type Frame = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TemplateDef = {
  /**
   * Base image for the template. It can be an HTMLCanvasElement, HTMLImageElement or ImageBitmap.
   */
  baseImage: CanvasImageSource;
  /** Optional override for the size of the output canvas */
  size?: { width: number; height: number };
  frame: Frame;
  labelBox?: Frame;
  labelText?: string;
  exportFormat?: "png" | "pdf";
};

export type ProcessResult = {
  item: WorkItem;
  resultado: "ok" | "error";
  mensaje?: string;
};
