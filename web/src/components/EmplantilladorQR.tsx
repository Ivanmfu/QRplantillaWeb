import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Frame, Item, ProcessResult, TemplateDef, UploadedQR, WorkItem } from "../lib/types";
import {
  indexUploadedQRs,
  parseCsvToItems,
  processItems,
  renderItem,
  resolveWorkItems,
  getCsvHeaders,
  createTemplateCsv,
  processItemsToBlobs,
  createZipFromBlobs,
  getQRForItem,
  prepareTemplateForItem,
} from "../lib/qrWorkflow";

type EmplantilladorQRProps = {
  template: TemplateDef;
  exportFormat?: "png" | "pdf";
  previewIndex?: number;
  onResults?: (results: ProcessResult[]) => void;
};

type StatusMessage = {
  type: "info" | "error";
  text: string;
};

function numeroToKey(numero: Item["numero"]): string {
  return typeof numero === "number" ? String(numero) : `${numero}`.trim();
}

type DragState = { type: "qr" | "label"; offsetX: number; offsetY: number };

type ResizeState = {
  startX: number;
  startY: number;
  startFrame: Frame;
  target: "qr" | "label";
  startText?: string;
};

type LabelBoxShape = { x: number; y: number; w: number; h: number; text?: string };

function cloneTemplateLabelBox(template: TemplateDef, fallbackText?: string): LabelBoxShape | null {
  if (!template.labelBox) {
    return null;
  }
  const baseText = fallbackText ?? template.labelText ?? "";
  return { ...template.labelBox, text: baseText };
}

function defaultLabelBoxFromFrame(frame: Frame, template: TemplateDef, fallbackText?: string): LabelBoxShape {
  return {
    x: frame.x,
    y: frame.y + frame.h + 10,
    w: frame.w,
    h: Math.max(20, Math.round(frame.h * 0.35)),
    text: fallbackText ?? template.labelText ?? "",
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (min > max) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function getTemplateDimensions(template: TemplateDef): { width: number; height: number } {
  if (template.size) {
    return { width: Math.round(template.size.width), height: Math.round(template.size.height) };
  }
  const base: any = template.baseImage;
  const width =
    base?.naturalWidth ??
    base?.videoWidth ??
    base?.width ??
    base?.canvas?.width ??
    0;
  const height =
    base?.naturalHeight ??
    base?.videoHeight ??
    base?.height ??
    base?.canvas?.height ??
    0;
  return {
    width: width || Math.max(template.frame.x + template.frame.w, 1),
    height: height || Math.max(template.frame.y + template.frame.h, 1),
  };
}

export const EmplantilladorQR: React.FC<EmplantilladorQRProps> = ({
  template,
  exportFormat,
  previewIndex = 0,
  onResults,
}) => {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const resizingRef = useRef<ResizeState | null>(null);
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string | null>(null);
  const [csvItems, setCsvItems] = useState<Item[] | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [headerMap, setHeaderMap] = useState<{ numero?: string; enlace?: string; nombreArchivoSalida?: string }>({});
  const [qrIndex, setQrIndex] = useState<Map<string, UploadedQR>>(new Map());
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [templateImage, setTemplateImage] = useState<HTMLImageElement | null>(null);
  const [templateBlobUrl, setTemplateBlobUrl] = useState<string | null>(null);
  const [frame, setFrame] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [labelBox, setLabelBox] = useState<LabelBoxShape | null>(null);
  const [selectedItemIndex, setSelectedItemIndex] = useState<number>(0);
  const [fontSize, setFontSize] = useState<number>(14);
  const [isBold, setIsBold] = useState<boolean>(false);
  const [textColor, setTextColor] = useState<string>('#000000');
  const [isTransparentBackground, setIsTransparentBackground] = useState<boolean>(false);
  const [showGuides, setShowGuides] = useState<{ horizontal: boolean; vertical: boolean }>({ horizontal: false, vertical: false });
  const [exportModal, setExportModal] = useState<{
    isOpen: boolean;
    status: string;
    progress: number;
    error?: string;
    canCancel: boolean;
  }>({ isOpen: false, status: '', progress: 0, canCancel: false });
  const editorRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<DragState | null>(null);
  const [results, setResults] = useState<ProcessResult[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [qrFolderName, setQrFolderName] = useState<string | null>(null);

  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const qrInputRef = useRef<HTMLInputElement | null>(null);

  const assignQrInputRef = useCallback((element: HTMLInputElement | null) => {
    if (element) {
      element.setAttribute("webkitdirectory", "true");
      element.setAttribute("directory", "true");
    }
    qrInputRef.current = element;
  }, []);

  const activeTemplate = useMemo<TemplateDef>(() => {
    const baseImage = templateImage ?? template.baseImage;
    const size = templateImage
      ? {
          width: templateImage.naturalWidth || templateImage.width,
          height: templateImage.naturalHeight || templateImage.height,
        }
      : template.size;
    const frameToUse = frame ?? template.frame;
    const labelFrame = labelBox
      ? { x: labelBox.x, y: labelBox.y, w: labelBox.w, h: labelBox.h }
      : template.labelBox;
    const labelText = labelBox?.text ?? template.labelText;

    const next: TemplateDef = {
      baseImage,
      frame: frameToUse,
      exportFormat: exportFormat ?? template.exportFormat,
    };

    if (size) {
      next.size = size;
    }
    if (labelFrame) {
      next.labelBox = labelFrame;
    }
    if (labelText !== undefined) {
      next.labelText = labelText;
    }

    return next;
  }, [exportFormat, frame, labelBox, template, templateImage]);

  const templateDimensions = useMemo(() => getTemplateDimensions(activeTemplate), [activeTemplate]);
  const templateSizeText = useMemo(() => {
    if (!templateDimensions.width || !templateDimensions.height) {
      return "";
    }
    return `${templateDimensions.width} × ${templateDimensions.height}px`;
  }, [templateDimensions]);
  const editorImageSrc = useMemo(() => {
    console.log('🔍 editorImageSrc recalculating...');
    console.log('  templateBlobUrl:', templateBlobUrl ? `${templateBlobUrl.substring(0, 30)}... (${templateBlobUrl.length} chars)` : 'null');
    console.log('  templateImage:', templateImage ? `${templateImage.width}x${templateImage.height}, src=${templateImage.src?.substring(0, 50)}` : 'null');
    console.log('  template.baseImage type:', template.baseImage.constructor.name);
    
    // 1) Prioriza el data URL ya calculado
    if (templateBlobUrl) {
      if (!templateBlobUrl.startsWith('data:')) {
        console.error('❌ CRITICAL: templateBlobUrl is NOT a data URL!', templateBlobUrl.substring(0, 100));
        return undefined;
      }
      console.log("✅ Editor image: using rasterized data URL, length:", templateBlobUrl.length);
      return templateBlobUrl;
    }

    // 2) Si hay HTMLImageElement, lo rasterizamos a PNG data URL (no usamos .src)
    if (templateImage) {
      // CRITICAL: Verificar que templateImage.src es data URL
      if (templateImage.src && !templateImage.src.startsWith('data:')) {
        console.error('❌ CRITICAL: templateImage.src is blob URL!', templateImage.src);
        return undefined;
      }
      
      try {
        const w = templateImage.naturalWidth || templateImage.width;
        const h = templateImage.naturalHeight || templateImage.height;
        if (w && h) {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(templateImage, 0, 0, w, h);
            const url = c.toDataURL('image/png');
            console.log('✅ Editor image: rasterized templateImage to data URL, length:', url.length);
            return url;
          }
        }
      } catch (e) {
        console.warn('⚠️ Editor image: could not rasterize templateImage', e);
      }
    }

    // 3) Fuente base del template
    const base = template.baseImage;
    if (base instanceof HTMLImageElement) {
      // CRITICAL: Verificar que base.src es data URL
      if (base.src && !base.src.startsWith('data:')) {
        console.error('❌ CRITICAL: base HTMLImageElement.src is blob URL!', base.src);
        return undefined;
      }
      
      try {
        const w = base.naturalWidth || base.width;
        const h = base.naturalHeight || base.height;
        if (w && h) {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(base, 0, 0, w, h);
            const url = c.toDataURL('image/png');
            console.log('✅ Editor image: rasterized base HTMLImageElement to data URL, length:', url.length);
            return url;
          }
        }
      } catch (e) {
        console.warn('⚠️ Editor image: could not rasterize base HTMLImageElement', e);
      }
    }

    if (base instanceof HTMLCanvasElement) {
      try {
        const dataUrl = base.toDataURL('image/png');
        console.log('✅ Editor image: using base canvas data URL, length:', dataUrl.length);
        return dataUrl;
      } catch (e) {
        console.error('❌ Editor image: failed to convert canvas to data URL', e);
      }
    }

    console.log('⚠️ Editor image: no valid image source');
    return undefined;
  }, [templateBlobUrl, templateImage, template]);

  useEffect(() => {
    if (!frame && template.frame) {
      setFrame({ ...template.frame });
    }
  }, [frame, template]);

  useEffect(() => {
    if (!labelBox) {
      const fromTemplate = cloneTemplateLabelBox(template);
      if (fromTemplate) {
        setLabelBox(fromTemplate);
      }
    } else if (!labelBox.text && template.labelText) {
      setLabelBox({ ...labelBox, text: template.labelText });
    }
  }, [labelBox, template]);

  // Actualizar etiqueta cuando cambie el elemento seleccionado o inicializar si no existe
  useEffect(() => {
    if (workItems.length > 0 && selectedItemIndex < workItems.length) {
      const selectedItem = workItems[selectedItemIndex];
      
      if (labelBox) {
        // Si labelBox existe, solo actualizar el texto
        if (selectedItem?.nombreArchivoSalida) {
          setLabelBox(prev => prev ? { ...prev, text: selectedItem.nombreArchivoSalida } : null);
        }
      } else if (frame) {
        // Si labelBox no existe pero tenemos frame, inicializar labelBox
        const imgHeight = templateImage?.naturalHeight || 600;
        const editorHeight = Math.min(800, imgHeight);
        const availableSpace = editorHeight - (frame.y + frame.h) - 50;
        
        let labelY;
        if (availableSpace > 40) {
          // Hay espacio debajo del QR
          labelY = frame.y + frame.h + 8;
        } else {
          // No hay espacio debajo, colocar arriba del QR
          labelY = Math.max(8, frame.y - 48);
        }
        
        const newLabelBox = {
          x: frame.x,
          y: labelY,
          w: frame.w,
          h: 40,
          text: selectedItem?.nombreArchivoSalida || 'nombre-salida'
        };
        setLabelBox(newLabelBox);
      }
    }
  }, [selectedItemIndex, workItems, labelBox, frame]);

  // No cleanup needed for data URLs

  const updateFrameField = useCallback(
    (field: keyof Frame, rawValue: number) => {
      setFrame((prev) => {
        const baseFrame = prev ?? template.frame;
        if (!baseFrame) {
          return prev;
        }
        const dims = templateDimensions;
        const widthLimit = dims.width || Math.max(baseFrame.x + baseFrame.w, 1);
        const heightLimit = dims.height || Math.max(baseFrame.y + baseFrame.h, 1);
        const next: Frame = { ...baseFrame };
        const value = Math.round(Number.isFinite(rawValue) ? rawValue : 0);
        switch (field) {
          case "x": {
            const maxX = Math.max(0, widthLimit - next.w);
            next.x = clamp(value, 0, maxX);
            break;
          }
          case "y": {
            const maxY = Math.max(0, heightLimit - next.h);
            next.y = clamp(value, 0, maxY);
            break;
          }
          case "w": {
            const maxW = Math.max(1, widthLimit - next.x);
            next.w = clamp(value, 8, maxW);
            break;
          }
          case "h": {
            const maxH = Math.max(1, heightLimit - next.y);
            next.h = clamp(value, 8, maxH);
            break;
          }
        }
        return next;
      });
    },
    [template, templateDimensions]
  );

  const updateLabelField = useCallback(
    (field: keyof Frame, rawValue: number) => {
      setLabelBox((prev) => {
        const templateBox = cloneTemplateLabelBox(template, prev?.text);
        const frameBox = frame ? defaultLabelBoxFromFrame(frame, template, prev?.text) : null;
        const base: LabelBoxShape | null = prev ?? templateBox ?? frameBox;
        if (!base) {
          return prev;
        }
        const dims = templateDimensions;
        const widthLimit = dims.width || Math.max(base.x + base.w, 1);
        const heightLimit = dims.height || Math.max(base.y + base.h, 1);
        const next: LabelBoxShape = { ...base, text: prev?.text ?? base.text };
        const value = Math.round(Number.isFinite(rawValue) ? rawValue : 0);
        switch (field) {
          case "x": {
            const maxX = Math.max(0, widthLimit - next.w);
            next.x = clamp(value, 0, maxX);
            break;
          }
          case "y": {
            const maxY = Math.max(0, heightLimit - next.h);
            next.y = clamp(value, 0, maxY);
            break;
          }
          case "w": {
            const maxW = Math.max(1, widthLimit - next.x);
            next.w = clamp(value, 20, maxW);
            break;
          }
          case "h": {
            const maxH = Math.max(1, heightLimit - next.y);
            next.h = clamp(value, 20, maxH);
            break;
          }
        }
        return next;
      });
    },
    [frame, template, templateDimensions]
  );

  const handleFrameNumberChange = useCallback(
    (field: keyof Frame) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      updateFrameField(field, value);
    },
    [updateFrameField]
  );

  const handleLabelNumberChange = useCallback(
    (field: keyof Frame) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      updateLabelField(field, value);
    },
    [updateLabelField]
  );

  useEffect(() => {
    const resolved = resolveWorkItems(csvItems, qrIndex);
    setWorkItems(resolved);
  }, [csvItems, qrIndex]);

  useEffect(() => {
    let mounted = true;
    async function gen() {
      if (!workItems || workItems.length === 0) {
        setQrPreviewUrl(null);
        return;
      }
      const sample = workItems[selectedItemIndex] || workItems[0];
      try {
        const qrFrame = activeTemplate.frame;
        const size = Math.round(Math.max(qrFrame.w, qrFrame.h));
        const canvas = await getQRForItem(sample, qrIndex, size);
        if (!mounted) return;
        setQrPreviewUrl(canvas.toDataURL("image/png"));
      } catch (err) {
        setQrPreviewUrl(null);
      }
    }
    gen();
    return () => { mounted = false; };
  }, [activeTemplate, qrIndex, workItems, selectedItemIndex]);

  useEffect(() => {
    let cancelled = false;
    async function updatePreview() {
      if (workItems.length === 0) {
        setPreviewUrl(null);
        return;
      }
      const index = Math.min(previewIndex, workItems.length - 1);
      try {
        const templateConfig = prepareTemplateForItem(activeTemplate, workItems[index]);
        const canvas = await renderItem(workItems[index], qrIndex, templateConfig);
        if (!cancelled) {
          setPreviewUrl(canvas.toDataURL("image/png"));
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setPreviewUrl(null);
          setStatus({ type: "error", text: `Error al generar vista previa: ${message}` });
        }
      }
    }
    updatePreview();
    return () => {
      cancelled = true;
    };
  }, [activeTemplate, previewIndex, qrIndex, workItems]);

  const handleCsvChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setCsvItems(null);
      setCsvFileName(null);
      return;
    }
    try {
      const headers = await getCsvHeaders(file);
      setCsvHeaders(headers);
      // if user hasn't set a map yet, try to auto-map common names
      if (!headerMap.numero) {
        const lower = headers.map((h) => h.toLowerCase());
        const find = (cands: string[]) => {
          for (const cand of cands) {
            const idx = lower.indexOf(cand);
            if (idx >= 0) return headers[idx];
          }
          return undefined;
        };
        setHeaderMap({
          numero: find(["numero", "number", "id", "_id", "title"]),
          enlace: find(["enlace", "link", "url"]),
          nombreArchivoSalida: find(["nombrearchivosalida", "nombrearchivo", "nombre", "output"]),
        });
      }
      const items = await parseCsvToItems(file, headerMap);
      setCsvItems(items);
      setCsvFileName(file.name);
      setStatus({ type: "info", text: `CSV cargado con ${items.length} filas.` });
      setResults([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ type: "error", text: message });
      setCsvItems(null);
      setCsvFileName(null);
    }
  }, []);

  // reparse CSV when headerMap changes and a file is loaded
  useEffect(() => {
    let cancelled = false;
    async function reparse() {
      if (!csvFileName || csvInputRef.current?.files?.[0] == null) return;
      try {
        const file = csvInputRef.current.files[0];
        const items = await parseCsvToItems(file, headerMap);
        if (!cancelled) {
          setCsvItems(items);
          setStatus({ type: "info", text: `CSV reparsado con ${items.length} filas.` });
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setStatus({ type: "error", text: message });
        }
      }
    }
    reparse();
    return () => {
      cancelled = true;
    };
  }, [headerMap, csvFileName]);

  const handleQrChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      setQrIndex(new Map());
      setQrFolderName(null);
      return;
    }
    const index = indexUploadedQRs(files);
    setQrIndex(new Map(index));
    const path = files[0]?.webkitRelativePath || files[0]?.name;
    if (path) {
      const folder = path.includes("/") ? path.split("/")[0] : "carpeta";
      setQrFolderName(folder);
    } else {
      setQrFolderName(`${files.length} archivos`);
    }
    setStatus({ type: "info", text: `Se indexaron ${index.size} QRs.` });
    setResults([]);
  }, []);

  const handleTemplateChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log("🖼️ HandleTemplateChange iniciado - v3.0 DIRECT");
    const file = event.target.files?.[0];
    if (!file) {
      console.log("❌ No file selected");
      setTemplateImage(null);
      setTemplateBlobUrl(null);
      return;
    }
    
    console.log("📁 File selected:", file.name, file.type, file.size);
    
    // Validar tipo de archivo
    if (!file.type.match(/^image\/(png|jpeg|jpg|svg\+xml)$/)) {
      console.log("❌ Invalid file type:", file.type);
      setStatus({ type: "error", text: "Por favor, sube una imagen válida (PNG, JPG, SVG)" });
      return;
    }
    
    setStatus({ type: "info", text: "Cargando plantilla..." });
    
    try {
      console.log("🔄 DIRECT: Loading to canvas without intermediate Image...");
      
      // Crear bitmap directamente desde el archivo
      const bitmap = await createImageBitmap(file);
      console.log("✅ ImageBitmap created:", bitmap.width, "x", bitmap.height);
      
      // Rasterizar inmediatamente a PNG data URL
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('No se pudo crear contexto 2D');
      }
      
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close(); // Liberar el bitmap
      
      const pngDataUrl = canvas.toDataURL('image/png');
      console.log('📦 PNG data URL created directly, length:', pngDataUrl.length, 'starts with:', pngDataUrl.substring(0, 30));
      
      // Verificar que es data URL
      if (!pngDataUrl.startsWith('data:')) {
        console.error('❌ Generated URL is not a data URL!', pngDataUrl.substring(0, 50));
        setStatus({ type: "error", text: "Error interno: URL no válida generada" });
        return;
      }
      
      // Crear imagen desde el data URL para obtener dimensiones
      const img = new Image();
      img.onload = () => {
        console.log("✅ Final image loaded:", img.naturalWidth, "x", img.naturalHeight);
        setTemplateImage(img);
        setStatus({ type: "info", text: `Plantilla cargada: ${img.naturalWidth}×${img.naturalHeight}px` });
        
        // set default frame centered
        const defaultFrame = { 
          x: Math.round(img.naturalWidth * 0.25), 
          y: Math.round(img.naturalHeight * 0.25), 
          w: Math.round(img.naturalWidth * 0.5), 
          h: Math.round(img.naturalHeight * 0.5) 
        };
        
        console.log("🎯 Default frame set:", defaultFrame);
        setFrame(defaultFrame);
        
        // Asegurar que el labelBox esté dentro del área visible
        // Calcular el espacio disponible considerando la escala del editor
        const editorHeight = Math.min(800, img.naturalHeight);
        const availableSpace = editorHeight - (defaultFrame.y + defaultFrame.h) - 50;
        
        let labelY;
        if (availableSpace > 40) {
          // Hay espacio debajo del QR
          labelY = defaultFrame.y + defaultFrame.h + 8;
        } else {
          // No hay espacio debajo, colocar arriba del QR
          labelY = Math.max(8, defaultFrame.y - 48);
        }
        
        const defaultLabelBox = { 
          x: defaultFrame.x, 
          y: labelY,
          w: Math.round(defaultFrame.w), 
          h: 40, 
          text: workItems.length > 0 ? workItems[selectedItemIndex]?.nombreArchivoSalida || 'nombre-salida' : 'nombre-salida'
        };
        
        setLabelBox(defaultLabelBox);
      };
      
      img.onerror = (error) => {
        console.error("❌ Error loading final image:", error);
        setStatus({ type: "error", text: "Error al cargar la plantilla procesada" });
      };
      
      // Guardar el data URL ANTES de cargar la imagen
      setTemplateBlobUrl(pngDataUrl);
      console.log("✅ templateBlobUrl set to data URL");
      
      // Ahora cargar la imagen
      img.src = pngDataUrl;
      
    } catch (error) {
      console.error("❌ Error processing template file:", error);
      setStatus({ type: "error", text: "Error al procesar el archivo de plantilla: " + (error instanceof Error ? error.message : String(error)) });
    }
  }, []);

  const handleClear = useCallback(() => {
    setCsvItems(null);
    setQrIndex(new Map());
    setWorkItems([]);
    setResults([]);
    setCsvFileName(null);
    setQrFolderName(null);
    setPreviewUrl(null);
    setStatus(null);
    
    // Limpiar template (no cleanup needed for data URLs)
    setTemplateImage(null);
    setTemplateBlobUrl(null);
    setFrame(null);
    setLabelBox(null);
    
    if (csvInputRef.current) {
      csvInputRef.current.value = "";
    }
    if (qrInputRef.current) {
      qrInputRef.current.value = "";
    }
  }, []);

  const handleProcess = useCallback(async () => {
    if (workItems.length === 0) {
      setStatus({ type: "error", text: "No hay elementos para procesar." });
      return;
    }
    setProcessing(true);
    setStatus({ type: "info", text: "Procesando lote..." });
    try {
      const renderOptions = {
        textColor,
        isTransparentBackground,
        fontSize,
        isBold
      };
      const processResults = await processItems(workItems, qrIndex, activeTemplate, renderOptions);
      setResults(processResults);
      setStatus({ type: "info", text: "Proceso finalizado." });
      if (onResults) {
        onResults(processResults);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ type: "error", text: message });
    } finally {
      setProcessing(false);
    }
  }, [activeTemplate, onResults, qrIndex, workItems, textColor, isTransparentBackground, fontSize, isBold]);

  // Función para exportar ZIP con modal de progreso
  const handleExportZip = useCallback(async () => {
    console.log('=== EXPORT ZIP DEBUG ===');
    console.log('workItems.length:', workItems.length);
    console.log('workItems:', workItems);
    console.log('qrIndex size:', qrIndex.size);
    console.log('activeTemplate:', activeTemplate);
    
    if (workItems.length === 0) {
      setStatus({ type: "error", text: "No hay elementos para exportar." });
      return;
    }

    // Inicializar modal
    setExportModal({
      isOpen: true,
      progress: 0,
      status: 'Preparando exportación...',
      canCancel: true,
      error: undefined
    });

    try {
      const total = workItems.length;
      
      // Procesar items con progreso
      setExportModal(prev => ({
        ...prev,
        progress: 10,
        status: 'Procesando plantillas...'
      }));

      console.log('=== DEBUGGING POSITIONS ===');
      console.log('frame state:', frame);
      console.log('labelBox state:', labelBox);
      console.log('template.frame:', template.frame);
      console.log('template.labelBox:', template.labelBox);
      console.log('activeTemplate.frame:', activeTemplate.frame);
      console.log('activeTemplate.labelBox:', activeTemplate.labelBox);
      console.log('==============================');
      
      console.log('Calling processItemsToBlobs with:', { workItems, qrIndex, activeTemplate });
      
      let entries: Array<{ nombre: string; blob: Blob }> = [];
      
      try {
        const renderOptions = {
          textColor,
          isTransparentBackground,
          fontSize,
          isBold
        };
        entries = await processItemsToBlobs(workItems, qrIndex, activeTemplate, renderOptions);
        console.log('processItemsToBlobs result:', entries);
        
        if (entries.length === 0) {
          console.error('No entries generated - checking why...');
          console.log('workItems detailed:', workItems.map(item => ({
            numero: item.numero,
            enlace: item.enlace,
            nombreArchivoSalida: item.nombreArchivoSalida,
            origenQR: item.origenQR
          })));
          
          setExportModal(prev => ({
            ...prev,
            error: 'No se generaron archivos para el ZIP. Verifica que los datos sean correctos.',
            canCancel: false
          }));
          return;
        }
      } catch (processError) {
        console.error('Error in processItemsToBlobs:', processError);
        setExportModal(prev => ({
          ...prev,
          error: `Error al procesar plantillas: ${processError instanceof Error ? processError.message : String(processError)}`,
          canCancel: false
        }));
        return;
      }

      setExportModal(prev => ({
        ...prev,
        progress: 80,
        status: 'Generando archivo ZIP...',
        canCancel: false
      }));

      const zipBlob = await createZipFromBlobs(entries);
      
      setExportModal(prev => ({
        ...prev,
        progress: 95,
        status: 'Iniciando descarga...'
      }));
      
      // Convertir blob a data URL para evitar problemas de revocación
      const reader = new FileReader();
      reader.onload = function() {
        const dataUrl = reader.result as string;
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = "plantilla_qrs.zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        setExportModal(prev => ({
          ...prev,
          progress: 100,
          status: `ZIP generado con ${entries.length} archivos`
        }));

        // Cerrar modal después de un breve delay
        setTimeout(() => {
          setExportModal(prev => ({ ...prev, isOpen: false }));
        }, 2000);
      };
      reader.readAsDataURL(zipBlob);
      
      setStatus({ type: "info", text: `ZIP generado con ${entries.length} archivos.` });
      
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportModal(prev => ({
        ...prev,
        error: `Error al generar ZIP: ${message}`,
        canCancel: false
      }));
      setStatus({ type: "error", text: `Error al generar ZIP: ${message}` });
    }
  }, [workItems, qrIndex, activeTemplate, textColor, isTransparentBackground, fontSize, isBold]);

  const resultsMap = useMemo(() => {
    const map = new Map<string, ProcessResult>();
    for (const result of results) {
      map.set(numeroToKey(result.item.numero), result);
    }
    return map;
  }, [results]);

  return (
    <div className="emplantillador-qr" style={styles.container}>
      <div style={styles.mappingPanel}>
        <h4>Mapeo de columnas CSV</h4>
        <div style={styles.mappingRow}>
          <label style={styles.smallLabel}>Campo "numero"</label>
          <select
            value={headerMap.numero || ""}
            onChange={(e) => setHeaderMap((m) => ({ ...m, numero: e.target.value || undefined }))}
          >
            <option value="">-- seleccionar --</option>
            {csvHeaders.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>

          <label style={styles.smallLabel}>Campo "enlace"</label>
          <select
            value={headerMap.enlace || ""}
            onChange={(e) => setHeaderMap((m) => ({ ...m, enlace: e.target.value || undefined }))}
          >
            <option value="">-- seleccionar --</option>
            {csvHeaders.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>

          <label style={styles.smallLabel}>Campo "nombreArchivoSalida"</label>
          <select
            value={headerMap.nombreArchivoSalida || ""}
            onChange={(e) => setHeaderMap((m) => ({ ...m, nombreArchivoSalida: e.target.value || undefined }))}
          >
            <option value="">-- seleccionar --</option>
            {csvHeaders.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="secondary"
            onClick={() => {
              const csv = createTemplateCsv(csvHeaders.length ? csvHeaders : undefined);
              
              // Usar data URL en lugar de blob URL
              const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
              const a = document.createElement("a");
              a.href = dataUrl;
              a.download = "plantilla.csv";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }}
          >
            Descargar plantilla
          </button>
        </div>
      </div>
      <div style={styles.dropzones}>
        <label className="dropzone-card" style={styles.dropzone}>
          <strong>CSV (opcional)</strong>
          <span style={styles.dropzoneHint}>{csvFileName || "Arrastra o selecciona un archivo CSV"}</span>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            style={styles.input}
            onChange={handleCsvChange}
          />
        </label>
        <label className="dropzone-card" style={styles.dropzone}>
          <strong>Carpeta de QRs (opcional)</strong>
          <span style={styles.dropzoneHint}>{qrFolderName || "Arrastra una carpeta o selecciona archivos .png/.svg"}</span>
          <input
            ref={assignQrInputRef}
            type="file"
            multiple
            style={styles.input}
            accept="image/png,image/svg+xml"
            onChange={handleQrChange}
          />
        </label>
        <label className="dropzone-card" style={styles.dropzone}>
          <strong>Plantilla base (opcional)</strong>
          <span style={styles.dropzoneHint}>{templateImage ? `Cargada: ${templateImage.width}×${templateImage.height}` : "Sube una imagen (.png/.jpg)"}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            style={styles.input}
            onChange={handleTemplateChange}
          />
        </label>
      </div>

      <div style={styles.actions}>
        <button type="button" onClick={handleProcess} disabled={processing}>
          {processing ? "Procesando..." : "Emplantillar y Exportar"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={handleExportZip}
          disabled={processing}
        >
          Exportar ZIP
        </button>
        <button type="button" className="secondary" onClick={handleClear} disabled={processing}>
          Limpiar
        </button>
      </div>

      {editorImageSrc && (
        <div style={styles.templateEditor}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ margin: 0 }}>Editor visual y vista previa</h4>
            {workItems.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button 
                  type="button" 
                  onClick={() => setSelectedItemIndex(Math.max(0, selectedItemIndex - 1))}
                  disabled={selectedItemIndex === 0}
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                >
                  ← Anterior
                </button>
                <span style={{ fontSize: '12px', color: '#666' }}>
                  {selectedItemIndex + 1} de {workItems.length}
                  {workItems[selectedItemIndex] && ` - ${workItems[selectedItemIndex].nombreArchivoSalida}`}
                </span>
                <button 
                  type="button" 
                  onClick={() => setSelectedItemIndex(Math.min(workItems.length - 1, selectedItemIndex + 1))}
                  disabled={selectedItemIndex >= workItems.length - 1}
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                >
                  Siguiente →
                </button>
              </div>
            )}
          </div>
          {templateSizeText && <div style={styles.editorMeta}>Dimensiones: {templateSizeText}</div>}
          <div
            ref={editorRef}
            style={{
              position: "relative",
              width: Math.min(800, templateImage?.naturalWidth || templateDimensions.width || 800),
              height: Math.min(800, templateImage?.naturalHeight || templateDimensions.height || 800),
              borderRadius: "18px",
              border: "1px solid rgba(255, 255, 255, 0.28)",
              background: "rgba(15, 23, 42, 0.35)",
              boxShadow: "var(--shadow-soft)",
              overflow: "hidden",
            }}
            onMouseMove={(e) => {
              const editorRect = editorRef.current?.getBoundingClientRect();
              const img = imageRef.current;
              if (!editorRect || !img) return;
              const imageRect = img.getBoundingClientRect();
              const scale = img.naturalWidth > 0 ? imageRect.width / img.naturalWidth : 1;
              const x = e.clientX - imageRect.left;
              const y = e.clientY - imageRect.top;
              const dragging = draggingRef.current;
              if (dragging && dragging.type === 'qr' && frame) {
                const newDisplayedX = x - dragging.offsetX;
                const newDisplayedY = y - dragging.offsetY;
                const newNatX = Math.round(newDisplayedX / scale);
                const newNatY = Math.round(newDisplayedY / scale);
                const finalX = Math.max(0, Math.min(newNatX, Math.round(img.naturalWidth - frame.w)));
                const finalY = Math.max(0, Math.min(newNatY, Math.round(img.naturalHeight - frame.h)));
                
                // Calcular si está centrado (con tolerancia de 5px)
                const centerX = finalX + frame.w / 2;
                const centerY = finalY + frame.h / 2;
                const canvasCenterX = img.naturalWidth / 2;
                const canvasCenterY = img.naturalHeight / 2;
                const tolerance = 5;
                
                const isHorizontallyCentered = Math.abs(centerX - canvasCenterX) <= tolerance;
                const isVerticallyCentered = Math.abs(centerY - canvasCenterY) <= tolerance;
                
                setShowGuides({ horizontal: isHorizontallyCentered, vertical: isVerticallyCentered });
                
                setFrame({
                  ...frame,
                  x: finalX,
                  y: finalY,
                });
              }
              if (dragging && dragging.type === 'label' && labelBox) {
                const newDisplayedX = x - dragging.offsetX;
                const newDisplayedY = y - dragging.offsetY;
                const newNatX = Math.round(newDisplayedX / scale);
                const newNatY = Math.round(newDisplayedY / scale);
                const finalX = Math.max(0, Math.min(newNatX, Math.round(img.naturalWidth - labelBox.w)));
                const finalY = Math.max(0, Math.min(newNatY, Math.round(img.naturalHeight - labelBox.h)));
                
                // Calcular si está centrado (con tolerancia de 5px)
                const centerX = finalX + labelBox.w / 2;
                const centerY = finalY + labelBox.h / 2;
                const canvasCenterX = img.naturalWidth / 2;
                const canvasCenterY = img.naturalHeight / 2;
                const tolerance = 5;
                
                const isHorizontallyCentered = Math.abs(centerX - canvasCenterX) <= tolerance;
                const isVerticallyCentered = Math.abs(centerY - canvasCenterY) <= tolerance;
                
                setShowGuides({ horizontal: isHorizontallyCentered, vertical: isVerticallyCentered });
                
                setLabelBox({
                  ...labelBox,
                  x: finalX,
                  y: finalY,
                });
              }
              const resizing = resizingRef.current;
              if (resizing) {
                const dx = (x - resizing.startX) / scale;
                const dy = (y - resizing.startY) / scale;
                if (resizing.target === 'qr') {
                  setFrame((prev) => {
                    const baseFrame = prev ?? resizing.startFrame;
                    const maxW = Math.max(8, Math.round(img.naturalWidth - baseFrame.x));
                    const maxH = Math.max(8, Math.round(img.naturalHeight - baseFrame.y));
                    const nextW = clamp(Math.round(resizing.startFrame.w + dx), 8, maxW);
                    const nextH = clamp(Math.round(resizing.startFrame.h + dy), 8, maxH);
                    if (prev && prev.w === nextW && prev.h === nextH) {
                      return prev;
                    }
                    return { ...baseFrame, w: nextW, h: nextH };
                  });
                } else if (resizing.target === 'label') {
                  setLabelBox((prev) => {
                    const startBox: LabelBoxShape = {
                      x: resizing.startFrame.x,
                      y: resizing.startFrame.y,
                      w: resizing.startFrame.w,
                      h: resizing.startFrame.h,
                      text: resizing.startText ?? prev?.text ?? '',
                    };
                    const baseBox = prev ?? startBox;
                    const maxW = Math.max(8, Math.round(img.naturalWidth - baseBox.x));
                    const maxH = Math.max(8, Math.round(img.naturalHeight - baseBox.y));
                    const nextW = clamp(Math.round(resizing.startFrame.w + dx), 8, maxW);
                    const nextH = clamp(Math.round(resizing.startFrame.h + dy), 8, maxH);
                    return { ...baseBox, w: nextW, h: nextH };
                  });
                }
              }
            }}
            onMouseUp={() => {
              draggingRef.current = null;
              resizingRef.current = null;
              setShowGuides({ horizontal: false, vertical: false });
            }}
          >
            <img
              ref={imageRef}
              src={editorImageSrc && editorImageSrc.startsWith('data:') ? editorImageSrc : ''}
              alt="Plantilla"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              onLoad={() => {
                setStatus({ type: "info", text: "Plantilla cargada correctamente" });
              }}
              onError={() => {
                setStatus({ type: "error", text: "Error al cargar la imagen de la plantilla" });
              }}
            />
            {editorImageSrc && !editorImageSrc.startsWith('data:') && (
              <div style={{ position: 'absolute', inset: 8, pointerEvents: 'none', color: '#f99', fontSize: 12 }}>
                Aviso: se intentó usar una URL no segura para la plantilla. Ignorada para evitar errores blob:.
              </div>
            )}

            {frame && imageRef.current && (() => {
              const img = imageRef.current!;
              const imageRect = img.getBoundingClientRect();
              const editorRect = editorRef.current!.getBoundingClientRect();
              const scale = img.naturalWidth > 0 ? imageRect.width / img.naturalWidth : 1;
              const offsetLeft = Math.round(imageRect.left - editorRect.left);
              const offsetTop = Math.round(imageRect.top - editorRect.top);
              const left = offsetLeft + Math.round(frame.x * scale);
              const top = offsetTop + Math.round(frame.y * scale);
              const width = Math.round(frame.w * scale);
              const height = Math.round(frame.h * scale);
              return (
                <div
                  style={{
                    position: 'absolute',
                    left,
                    top,
                    width,
                    height,
                    border: '2px dashed #00a',
                    boxSizing: 'border-box',
                    cursor: 'move',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255,255,255,0.0)',
                  }}
                  onMouseDown={(e) => {
                    const imageRect2 = imageRef.current?.getBoundingClientRect();
                    if (!imageRect2) return;
                    draggingRef.current = {
                      type: 'qr',
                      offsetX: e.clientX - imageRect2.left - Math.round(frame.x * scale),
                      offsetY: e.clientY - imageRect2.top - Math.round(frame.y * scale),
                    };
                  }}
                >
                  {qrPreviewUrl ? (
                    <img src={qrPreviewUrl} alt="QR" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'repeating-conic-gradient(#0000 0% 25%, #000 0% 50%)' }} />
                  )}
                  <div
                    onMouseDown={(e) => {
                      const rect = editorRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      e.stopPropagation();
                      e.preventDefault();
                      resizingRef.current = {
                        target: 'qr',
                        startX: e.clientX - rect.left,
                        startY: e.clientY - rect.top,
                        startFrame: { ...frame },
                      };
                    }}
                    style={{ position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, background: '#00a', cursor: 'nwse-resize' }}
                  />
                </div>
              );
            })()}

            {labelBox && imageRef.current && (() => {
              console.log("🏷️ DEBUG: LabelBox rendering:", labelBox, "fontSize:", fontSize, "isBold:", isBold);
              const img = imageRef.current!;
              const imageRect = img.getBoundingClientRect();
              const editorRect = editorRef.current!.getBoundingClientRect();
              const scale = img.naturalWidth > 0 ? imageRect.width / img.naturalWidth : 1;
              const offsetLeft = Math.round(imageRect.left - editorRect.left);
              const offsetTop = Math.round(imageRect.top - editorRect.top);
              const left = offsetLeft + Math.round(labelBox.x * scale);
              const top = offsetTop + Math.round(labelBox.y * scale);
              const width = Math.round(labelBox.w * scale);
              const height = Math.round(labelBox.h * scale);
              console.log("🏷️ DEBUG: Position:", { left, top, width, height });
              
              return (
                <div
                  style={{
                    position: 'absolute',
                    left,
                    top,
                    width,
                    height,
                    border: '1px solid #333', // Restaurado a normal
                    backgroundColor: isTransparentBackground ? 'transparent' : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 4,
                    boxSizing: 'border-box',
                    cursor: 'move',
                    zIndex: 10,
                  }}
                  onMouseDown={(e) => {
                    const imageRect2 = imageRef.current?.getBoundingClientRect();
                    if (!imageRect2) return;
                    draggingRef.current = {
                      type: 'label',
                      offsetX: e.clientX - imageRect2.left - Math.round(labelBox.x * scale),
                      offsetY: e.clientY - imageRect2.top - Math.round(labelBox.y * scale),
                    };
                  }}
                >
                  <input
                    style={{ 
                      width: '100%', 
                      border: 'none', 
                      outline: 'none', 
                      textAlign: 'center',
                      fontSize: `${fontSize}px`,
                      fontWeight: isBold ? 'bold' : 'normal',
                      fontFamily: 'Arial, sans-serif',
                      color: textColor,
                      backgroundColor: 'transparent'
                    }}
                    value={labelBox.text}
                    onChange={(e) => setLabelBox({ ...labelBox, text: e.target.value })}
                  />
                  <div
                    onMouseDown={(e) => {
                      const rect = editorRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      e.stopPropagation();
                      e.preventDefault();
                      resizingRef.current = {
                        target: 'label',
                        startX: e.clientX - rect.left,
                        startY: e.clientY - rect.top,
                        startFrame: { x: labelBox.x, y: labelBox.y, w: labelBox.w, h: labelBox.h },
                        startText: labelBox.text,
                      };
                    }}
                    style={{ position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, background: '#333', cursor: 'nwse-resize' }}
                  />
                </div>
              );
            })()}
            
            {/* Guías de centrado */}
            {imageRef.current && (showGuides.horizontal || showGuides.vertical) && (() => {
              const img = imageRef.current!;
              const imageRect = img.getBoundingClientRect();
              const editorRect = editorRef.current!.getBoundingClientRect();
              const scale = img.naturalWidth > 0 ? imageRect.width / img.naturalWidth : 1;
              const offsetLeft = Math.round(imageRect.left - editorRect.left);
              const offsetTop = Math.round(imageRect.top - editorRect.top);
              
              return (
                <>
                  {/* Guía horizontal (línea vertical) */}
                  {showGuides.horizontal && (
                    <div
                      style={{
                        position: 'absolute',
                        left: offsetLeft + Math.round((img.naturalWidth / 2) * scale),
                        top: offsetTop,
                        width: '1px',
                        height: Math.round(img.naturalHeight * scale),
                        backgroundColor: '#ff6b6b',
                        zIndex: 5,
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                  {/* Guía vertical (línea horizontal) */}
                  {showGuides.vertical && (
                    <div
                      style={{
                        position: 'absolute',
                        left: offsetLeft,
                        top: offsetTop + Math.round((img.naturalHeight / 2) * scale),
                        width: Math.round(img.naturalWidth * scale),
                        height: '1px',
                        backgroundColor: '#ff6b6b',
                        zIndex: 5,
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                </>
              );
            })()}
          </div>
          <div style={{ marginTop: 8 }}>
            <small>Puedes arrastrar el cuadro del QR y la etiqueta para posicionarlos. Cambia el texto en la etiqueta si quieres.</small>
          </div>
          <div style={styles.editorControls}>
            <div style={styles.editorGroup}>
              <span style={styles.editorGroupTitle}>QR</span>
              <label style={styles.editorField}>
                <span style={styles.editorFieldLabel}>X</span>
                <input
                  type="number"
                  value={frame ? frame.x : ''}
                  onChange={handleFrameNumberChange('x')}
                  min={0}
                  step={1}
                  disabled={!frame}
                  style={styles.editorFieldInput}
                />
              </label>
              <label style={styles.editorField}>
                <span style={styles.editorFieldLabel}>Y</span>
                <input
                  type="number"
                  value={frame ? frame.y : ''}
                  onChange={handleFrameNumberChange('y')}
                  min={0}
                  step={1}
                  disabled={!frame}
                  style={styles.editorFieldInput}
                />
              </label>
              <label style={styles.editorField}>
                <span style={styles.editorFieldLabel}>Ancho</span>
                <input
                  type="number"
                  value={frame ? frame.w : ''}
                  onChange={handleFrameNumberChange('w')}
                  min={8}
                  step={1}
                  disabled={!frame}
                  style={styles.editorFieldInput}
                />
              </label>
              <label style={styles.editorField}>
                <span style={styles.editorFieldLabel}>Alto</span>
                <input
                  type="number"
                  value={frame ? frame.h : ''}
                  onChange={handleFrameNumberChange('h')}
                  min={8}
                  step={1}
                  disabled={!frame}
                  style={styles.editorFieldInput}
                />
              </label>
            </div>

            <div style={styles.editorGroup}>
              <span style={styles.editorGroupTitle}>Etiqueta</span>
              <label style={styles.editorField}>
                <span style={styles.editorFieldLabel}>X</span>
                <input
                  type="number"
                  value={labelBox ? labelBox.x : ''}
                  onChange={handleLabelNumberChange('x')}
                  min={0}
                  step={1}
                  disabled={!labelBox}
                  style={styles.editorFieldInput}
                />
              </label>
              <label style={styles.editorField}>
                <span style={styles.editorFieldLabel}>Y</span>
                <input
                  type="number"
                  value={labelBox ? labelBox.y : ''}
                  onChange={handleLabelNumberChange('y')}
                  min={0}
                  step={1}
                  disabled={!labelBox}
                  style={styles.editorFieldInput}
                />
              </label>
              <label style={styles.editorField}>
                <span style={styles.editorFieldLabel}>Ancho</span>
                <input
                  type="number"
                  value={labelBox ? labelBox.w : ''}
                  onChange={handleLabelNumberChange('w')}
                  min={20}
                  step={1}
                  disabled={!labelBox}
                  style={styles.editorFieldInput}
                />
              </label>
              <label style={styles.editorField}>
                <span style={styles.editorFieldLabel}>Alto</span>
                <input
                  type="number"
                  value={labelBox ? labelBox.h : ''}
                  onChange={handleLabelNumberChange('h')}
                  min={20}
                  step={1}
                  disabled={!labelBox}
                  style={styles.editorFieldInput}
                />
              </label>
              <label style={styles.editorField}>
                <span style={styles.editorFieldLabel}>Tamaño</span>
                <input
                  type="number"
                  value={fontSize}
                  onChange={(e) => setFontSize(Math.max(8, Math.min(72, parseInt(e.target.value) || 14)))}
                  min={8}
                  max={72}
                  step={1}
                  disabled={!labelBox}
                  style={styles.editorFieldInput}
                />
              </label>
              <label style={{...styles.editorField, flexDirection: 'row', alignItems: 'center', gap: '8px'}}>
                <input
                  type="checkbox"
                  checked={isBold}
                  onChange={(e) => setIsBold(e.target.checked)}
                  disabled={!labelBox}
                  style={{ margin: 0 }}
                />
                <span style={styles.editorFieldLabel}>Negrita</span>
              </label>
              <label style={styles.editorField}>
                <span style={styles.editorFieldLabel}>Color</span>
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  disabled={!labelBox}
                  style={{ width: '40px', height: '30px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                />
              </label>
              <label style={{...styles.editorField, flexDirection: 'row', alignItems: 'center', gap: '8px'}}>
                <input
                  type="checkbox"
                  checked={isTransparentBackground}
                  onChange={(e) => setIsTransparentBackground(e.target.checked)}
                  disabled={!labelBox}
                  style={{ margin: 0 }}
                />
                <span style={styles.editorFieldLabel}>Fondo transparente</span>
              </label>
            </div>
          </div>
        </div>
      )}


      {status && (
        <div
          style={{
            ...styles.status,
            color:
              status.type === "error"
                ? "rgba(255, 228, 230, 0.95)"
                : "rgba(224, 242, 254, 0.95)",
            backgroundColor:
              status.type === "error"
                ? "rgba(248, 113, 113, 0.18)"
                : "rgba(59, 130, 246, 0.22)",
            borderColor:
              status.type === "error"
                ? "rgba(248, 113, 113, 0.45)"
                : "rgba(125, 211, 252, 0.45)",
            boxShadow:
              status.type === "error"
                ? "0 18px 45px -28px rgba(248, 113, 113, 0.65)"
                : "0 18px 45px -28px rgba(59, 130, 246, 0.6)",
          }}
        >
          {status.text}
        </div>
      )}

      <div style={styles.content}>
        <div style={styles.tableWrapper}>
          <h3>Lote</h3>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>numero</th>
                <th style={styles.th}>enlace</th>
                <th style={styles.th}>nombreArchivoSalida</th>
                <th style={styles.th}>origenQR</th>
                <th style={styles.th}>resultado</th>
              </tr>
            </thead>
            <tbody>
              {workItems.length === 0 ? (
                <tr>
                  <td style={styles.td} colSpan={5}>
                    No hay elementos cargados.
                  </td>
                </tr>
              ) : (
                workItems.map((item: { numero: string | number; enlace: any; nombreArchivoSalida: any; origenQR: any; }) => {
                  const key = numeroToKey(item.numero);
                  const result = resultsMap.get(key);
                  return (
                    <tr key={key}>
                      <td style={styles.td}>{key}</td>
                      <td style={styles.td}>{item.enlace}</td>
                      <td style={styles.td}>{item.nombreArchivoSalida}</td>
                      <td style={styles.td}>{item.origenQR}</td>
                      <td
                        style={styles.td}
                        title={result && result.mensaje ? result.mensaje : undefined}
                      >
                        {result ? result.resultado : processing ? "procesando" : "pendiente"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Modal de progreso de exportación */}
      {exportModal.isOpen && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            zIndex: 9999,
            paddingTop: '10vh',
          }}
          onClick={(e) => {
            // Cerrar modal si se hace click en el overlay (no en el contenido)
            if (e.target === e.currentTarget && exportModal.canCancel) {
              setExportModal(prev => ({ ...prev, isOpen: false }));
            }
          }}
        >
          <div style={{
            backgroundColor: 'var(--color-background)',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '400px',
            width: '90%',
            maxHeight: '80vh',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            margin: '20px',
            position: 'relative',
          }}>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '600' }}>
                Exportando Plantillas
              </h3>
              <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: '14px' }}>
                {exportModal.status}
              </p>
            </div>
            
            {!exportModal.error && (
              <div style={{ marginBottom: '24px' }}>
                <div style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${exportModal.progress}%`,
                    height: '100%',
                    backgroundColor: '#3b82f6',
                    transition: 'width 0.3s ease',
                    borderRadius: '4px',
                  }} />
                </div>
                <div style={{ 
                  marginTop: '8px', 
                  fontSize: '12px', 
                  color: 'var(--color-muted)',
                  textAlign: 'center' 
                }}>
                  {exportModal.progress}%
                </div>
              </div>
            )}
            
            {exportModal.error && (
              <div style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '24px',
              }}>
                <p style={{ margin: 0, color: '#ef4444', fontSize: '14px' }}>
                  {exportModal.error}
                </p>
              </div>
            )}
            
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              {exportModal.canCancel && !exportModal.error && (
                <button
                  type="button"
                  onClick={() => setExportModal({ ...exportModal, isOpen: false })}
                  style={{
                    padding: '8px 16px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '8px',
                    backgroundColor: 'transparent',
                    color: 'var(--color-foreground)',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Cancelar
                </button>
              )}
              
              {(exportModal.error || exportModal.progress === 100) && (
                <button
                  type="button"
                  onClick={() => setExportModal({ ...exportModal, isOpen: false })}
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    borderRadius: '8px',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  {exportModal.error ? 'Cerrar' : 'Listo'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "1.75rem",
    fontFamily: "var(--font-sans)",
  },
  dropzones: {
    display: "flex",
    flexWrap: "wrap",
    gap: "1rem",
  },
  dropzone: {
    flex: "1 1 260px",
    border: "1px solid var(--border-glass)",
    borderRadius: "20px",
    padding: "1.5rem",
    position: "relative",
    minHeight: "140px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    background: "var(--surface-glass)",
    color: "var(--color-foreground)",
    backdropFilter: "blur(24px)",
    boxShadow: "var(--shadow-soft)",
    transition: "border-color 0.35s ease, box-shadow 0.35s ease",
  },
  dropzoneHint: {
    marginTop: "0.65rem",
    fontSize: "0.9rem",
    color: "var(--color-subtle)",
    lineHeight: 1.45,
  },
  input: {
    position: "absolute",
    inset: 0,
    opacity: 0,
    cursor: "pointer",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.75rem",
    alignItems: "center",
  },
  templateEditor: {
    background: "rgba(15, 23, 42, 0.45)",
    borderRadius: "24px",
    border: "1px solid var(--border-glass)",
    padding: "1.5rem",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    boxShadow: "var(--shadow-soft)",
    backdropFilter: "blur(24px)",
  },
  editorMeta: {
    fontSize: "0.85rem",
    color: "var(--color-muted)",
  },
  editorControls: {
    display: "flex",
    flexWrap: "wrap",
    gap: "1rem",
    alignItems: "flex-end",
  },
  editorGroup: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.65rem",
  },
  editorGroupTitle: {
    fontWeight: 600,
    fontSize: "0.95rem",
    letterSpacing: "0.01em",
  },
  editorField: {
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
    minWidth: "90px",
  },
  editorFieldLabel: {
    fontSize: "0.8rem",
    color: "var(--color-muted)",
    letterSpacing: "0.01em",
  },
  editorFieldInput: {
    width: "100%",
    padding: "0.35rem 0.6rem",
    border: "1px solid var(--border-subtle)",
    borderRadius: "10px",
    fontSize: "0.9rem",
    background: "rgba(15, 23, 42, 0.45)",
    color: "var(--color-foreground)",
  },
  status: {
    padding: "0.9rem 1.25rem",
    borderRadius: "14px",
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    boxShadow: "var(--shadow-soft)",
  },
  content: {
    display: "flex",
    flexWrap: "wrap",
    gap: "1.5rem",
  },
  preview: {
    flex: "1 1 280px",
    minWidth: "260px",
    background: "rgba(15, 23, 42, 0.5)",
    borderRadius: "24px",
    border: "1px solid var(--border-glass)",
    padding: "1.25rem",
    boxShadow: "var(--shadow-soft)",
    backdropFilter: "blur(24px)",
  },
  previewImage: {
    width: "100%",
    height: "auto",
    borderRadius: "18px",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    boxShadow: "0 12px 30px -22px rgba(15, 23, 42, 0.85)",
  },
  previewPlaceholder: {
    padding: "2.5rem 1.5rem",
    textAlign: "center",
    color: "var(--color-subtle)",
    border: "1px dashed rgba(255, 255, 255, 0.25)",
    borderRadius: "18px",
    background: "rgba(15, 23, 42, 0.35)",
  },
  mappingPanel: {
    border: "1px solid var(--border-glass)",
    padding: "1rem",
    borderRadius: "20px",
    background: "rgba(15, 23, 42, 0.4)",
    boxShadow: "var(--shadow-soft)",
    backdropFilter: "blur(24px)",
  },
  mappingRow: {
    display: "flex",
    gap: "0.75rem",
    alignItems: "center",
    flexWrap: "wrap",
  },
  smallLabel: {
    fontSize: "0.85rem",
    color: "var(--color-muted)",
    fontWeight: 500,
    letterSpacing: "0.01em",
  },
  tableWrapper: {
    flex: "2 1 400px",
    minWidth: "320px",
    background: "rgba(15, 23, 42, 0.55)",
    borderRadius: "24px",
    border: "1px solid var(--border-glass)",
    padding: "1.25rem",
    overflow: "auto",
    boxShadow: "var(--shadow-soft)",
    backdropFilter: "blur(24px)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    borderBottom: "1px solid rgba(255, 255, 255, 0.15)",
    padding: "0.6rem",
    backgroundColor: "rgba(148, 163, 184, 0.18)",
    fontWeight: 600,
  },
  td: {
    padding: "0.6rem",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
    verticalAlign: "top",
    wordBreak: "break-word",
    color: "var(--color-foreground)",
  },
};

export default EmplantilladorQR;
