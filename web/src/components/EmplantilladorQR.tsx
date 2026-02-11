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
  exportPrintPDF,
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

// Size presets for PDF export
type SizePreset = 'original' | 'tarjeta' | 'a6' | 'a5' | 'custom';
type SizeUnit = 'px' | 'cm';

const SIZE_PRESETS: Record<SizePreset, { label: string; width: number; height: number }> = {
  original: { label: 'Tamaño original', width: 0, height: 0 },
  tarjeta: { label: 'Tarjeta 5×9 cm', width: 5, height: 9 },
  a6: { label: 'A6 (10.5×14.8 cm)', width: 10.5, height: 14.8 },
  a5: { label: 'A5 (14.8×21 cm)', width: 14.8, height: 21 },
  custom: { label: 'Personalizado', width: 0, height: 0 },
};

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
  const [frame, setFrame] = useState<{ x: number; y: number; w: number; h: number } | null>(() => {
    const saved = localStorage.getItem('qr_frame');
    return saved ? JSON.parse(saved) : null;
  });
  const [labelBox, setLabelBox] = useState<LabelBoxShape | null>(null);
  const [selectedItemIndex, setSelectedItemIndex] = useState<number>(0);
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('qr_fontSize');
    return saved ? parseInt(saved) : 14;
  });
  const [isBold, setIsBold] = useState<boolean>(() => {
    return localStorage.getItem('qr_isBold') === 'true';
  });
  const [isItalic, setIsItalic] = useState<boolean>(() => {
    return localStorage.getItem('qr_isItalic') === 'true';
  });
  const [fontFamily, setFontFamily] = useState<string>(() => {
    return localStorage.getItem('qr_fontFamily') || 'Inter';
  });
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>(() => {
    const saved = localStorage.getItem('qr_textAlign') as 'left' | 'center' | 'right';
    return saved || 'center';
  });
  const [lineHeight, setLineHeight] = useState<number>(() => {
    const saved = localStorage.getItem('qr_lineHeight');
    return saved ? parseFloat(saved) : 1.2;
  });
  const [letterSpacing, setLetterSpacing] = useState<number>(() => {
    const saved = localStorage.getItem('qr_letterSpacing');
    return saved ? parseFloat(saved) : 0;
  });
  const [textColor, setTextColor] = useState<string>(() => {
    return localStorage.getItem('qr_textColor') || '#000000';
  });
  const [isTransparentBackground, setIsTransparentBackground] = useState<boolean>(() => {
    return localStorage.getItem('qr_transparentBg') === 'true';
  });
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
  // Estados para inputs numéricos "en curso" (permiten cadenas vacías)
  const [frameInputs, setFrameInputs] = useState<Partial<Record<keyof Frame, string>>>({});
  // Mantener relación 1:1 en el QR
  const [keepSquare, setKeepSquare] = useState<boolean>(true);
  // Drag & Drop state
  const [dragOver, setDragOver] = useState<{ csv: boolean; qr: boolean; template: boolean }>({ csv: false, qr: false, template: false });
  // Export options states
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [selectedExportFormat, setSelectedExportFormat] = useState<'png' | 'pdf' | 'svg'>('pdf');
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>('cm');
  const [sizePreset, setSizePreset] = useState<SizePreset>('original');
  const [customWidthCm, setCustomWidthCm] = useState(7);
  const [customHeightCm, setCustomHeightCm] = useState(10);
  const [showCropMarks, setShowCropMarks] = useState(false);
  const [bleedMm, setBleedMm] = useState(3);

  // Save to localStorage when values change
  useEffect(() => {
    if (frame) localStorage.setItem('qr_frame', JSON.stringify(frame));
  }, [frame]);
  useEffect(() => { localStorage.setItem('qr_fontSize', fontSize.toString()); }, [fontSize]);
  useEffect(() => { localStorage.setItem('qr_isBold', isBold.toString()); }, [isBold]);
  useEffect(() => { localStorage.setItem('qr_isItalic', isItalic.toString()); }, [isItalic]);
  useEffect(() => { localStorage.setItem('qr_fontFamily', fontFamily); }, [fontFamily]);
  useEffect(() => { localStorage.setItem('qr_textAlign', textAlign); }, [textAlign]);
  useEffect(() => { localStorage.setItem('qr_lineHeight', lineHeight.toString()); }, [lineHeight]);
  useEffect(() => { localStorage.setItem('qr_letterSpacing', letterSpacing.toString()); }, [letterSpacing]);
  useEffect(() => { localStorage.setItem('qr_textColor', textColor); }, [textColor]);
  useEffect(() => { localStorage.setItem('qr_transparentBg', isTransparentBackground.toString()); }, [isTransparentBackground]);

  const resetTextDefaults = useCallback(() => {
    setFontSize(14);
    setIsBold(false);
    setIsItalic(false);
    setFontFamily('Inter');
    setTextAlign('center');
    setLineHeight(1.2);
    setLetterSpacing(0);
    setTextColor('#000000');
    setIsTransparentBackground(false);
  }, []);

  // Keyboard shortcuts for QR manipulation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if we have a frame and no input is focused
      if (!frame) return;
      const activeEl = document.activeElement;
      if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLSelectElement) {
        return;
      }

      const step = e.shiftKey ? 10 : 1;
      let handled = false;

      switch (e.key) {
        case 'ArrowLeft':
          setFrame(prev => prev ? { ...prev, x: Math.max(0, prev.x - step) } : prev);
          handled = true;
          break;
        case 'ArrowRight':
          setFrame(prev => prev ? { ...prev, x: prev.x + step } : prev);
          handled = true;
          break;
        case 'ArrowUp':
          setFrame(prev => prev ? { ...prev, y: Math.max(0, prev.y - step) } : prev);
          handled = true;
          break;
        case 'ArrowDown':
          setFrame(prev => prev ? { ...prev, y: prev.y + step } : prev);
          handled = true;
          break;
        case '+':
        case '=':
          setFrame(prev => {
            if (!prev) return prev;
            const newSize = Math.min(prev.w + step, 500);
            return keepSquare ? { ...prev, w: newSize, h: newSize } : { ...prev, w: newSize };
          });
          handled = true;
          break;
        case '-':
        case '_':
          setFrame(prev => {
            if (!prev) return prev;
            const newSize = Math.max(prev.w - step, 20);
            return keepSquare ? { ...prev, w: newSize, h: newSize } : { ...prev, w: newSize };
          });
          handled = true;
          break;
      }

      if (handled) {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [frame, keepSquare]);

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
    // 1) Prioriza el data URL ya calculado
    if (templateBlobUrl) {
      if (!templateBlobUrl.startsWith('data:')) {
        return undefined;
      }
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
        return dataUrl;
      } catch (e) {
        console.error('❌ Editor image: failed to convert canvas to data URL', e);
      }
    }

    return undefined;
  }, [templateBlobUrl, templateImage, template]);

  useEffect(() => {
    // Solo usar template.frame si no hay plantilla personalizada y no hay frame personalizado
    if (!frame && template.frame && !templateImage) {
      setFrame({ ...template.frame });
    }
  }, [frame, template, templateImage]);

  useEffect(() => {
    // Only initialize labelBox once when component mounts or template changes
    setLabelBox((prev) => {
      if (!prev) {
        const fromTemplate = cloneTemplateLabelBox(template);
        return fromTemplate || null;
      }
      if (!prev.text && template.labelText) {
        return { ...prev, text: template.labelText };
      }
      return prev;
    });
  }, [template]);

  // Actualizar etiqueta cuando cambie el elemento seleccionado o inicializar si no existe
  useEffect(() => {
    if (workItems.length > 0 && selectedItemIndex < workItems.length) {
      const selectedItem = workItems[selectedItemIndex];

      // Only update text, not create new labelBox (that's handled elsewhere)
      if (selectedItem?.nombreArchivoSalida) {
        setLabelBox(prev => prev ? { ...prev, text: selectedItem.nombreArchivoSalida } : null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemIndex, workItems]);

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

  // Cuando el frame cambie por arrastre/resize u otros, limpiamos borradores para que se sincronicen con el valor real
  useEffect(() => {
    setFrameInputs({});
  }, [frame]);

  // Si activamos mantener cuadrado, igualamos alto=ancho con el mejor tamaño posible
  useEffect(() => {
    if (!keepSquare || !frame) return;
    setFrame((prev) => {
      if (!prev) return prev;
      const dims = templateDimensions;
      const widthLimit = dims.width || Math.max(prev.x + prev.w, 1);
      const heightLimit = dims.height || Math.max(prev.y + prev.h, 1);
      const maxW = Math.max(8, Math.round(widthLimit - prev.x));
      const maxH = Math.max(8, Math.round(heightLimit - prev.y));
      const size = clamp(prev.w, 8, Math.min(maxW, maxH));
      if (prev.w === size && prev.h === size) return prev;
      return { ...prev, w: size, h: size };
    });
  }, [keepSquare]);

  const updateFrameSquareSize = useCallback((rawSize: number) => {
    setFrame((prev) => {
      const baseFrame = prev ?? template.frame;
      if (!baseFrame) return prev;
      const dims = templateDimensions;
      const widthLimit = dims.width || Math.max(baseFrame.x + baseFrame.w, 1);
      const heightLimit = dims.height || Math.max(baseFrame.y + baseFrame.h, 1);
      const maxW = Math.max(8, Math.round(widthLimit - baseFrame.x));
      const maxH = Math.max(8, Math.round(heightLimit - baseFrame.y));
      const maxSize = Math.min(maxW, maxH);
      const nextSize = clamp(Math.round(Number.isFinite(rawSize) ? rawSize : 0), 8, maxSize);
      return { ...baseFrame, w: nextSize, h: nextSize };
    });
  }, [template, templateDimensions]);

  // Manejadores para inputs de frame que permiten vacío y aplican clamp en blur
  const handleFrameInputChange = useCallback((field: keyof Frame) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const v = event.target.value;
    setFrameInputs((prev) => {
      const next = { ...prev };
      next[field] = v;
      // Si se mantiene cuadrado y se edita ancho/alto, reflejar en el otro input
      if (keepSquare && (field === 'w' || field === 'h')) {
        next[field === 'w' ? 'h' : 'w'] = v;
      }
      return next;
    });

    if (v === '') return; // permitir vacío temporalmente
    const num = Number(v);
    if (!Number.isFinite(num)) return;
    if (keepSquare && (field === 'w' || field === 'h')) {
      updateFrameSquareSize(num);
    } else {
      updateFrameField(field, num);
    }
  }, [keepSquare, updateFrameField, updateFrameSquareSize]);

  const handleFrameInputBlur = useCallback((field: keyof Frame) => () => {
    const draft = frameInputs[field];
    if (draft === undefined) return;
    if (draft === '') {
      // Restaurar a valor actual del frame
      setFrameInputs((prev) => {
        const n = { ...prev };
        delete n[field];
        return n;
      });
      return;
    }
    const num = Number(draft);
    if (Number.isFinite(num)) {
      if (keepSquare && (field === 'w' || field === 'h')) {
        updateFrameSquareSize(num);
      } else {
        updateFrameField(field, num);
      }
    }
    // Limpiar draft para volver a mostrar valor real
    setFrameInputs((prev) => {
      const n = { ...prev };
      delete n[field];
      if (keepSquare && (field === 'w' || field === 'h')) {
        delete n[field === 'w' ? 'h' : 'w'];
      }
      return n;
    });
  }, [frameInputs, keepSquare, updateFrameField, updateFrameSquareSize]);

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
      console.log("🔄 Loading image file...");

      let pngDataUrl: string;

      // Para SVG, usar método alternativo más robusto
      if (file.type === 'image/svg+xml') {
        console.log("🎨 SVG detected, using FileReader method...");

        // Leer SVG como texto
        const svgText = await file.text();

        // Intentar obtener dimensiones del SVG
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgElement = svgDoc.documentElement;

        // Extraer dimensiones del SVG (width/height o viewBox)
        let svgWidth = parseFloat(svgElement.getAttribute('width') || '0');
        let svgHeight = parseFloat(svgElement.getAttribute('height') || '0');

        if (!svgWidth || !svgHeight) {
          const viewBox = svgElement.getAttribute('viewBox');
          if (viewBox) {
            const parts = viewBox.split(/\s+|,/);
            svgWidth = parseFloat(parts[2] || '0');
            svgHeight = parseFloat(parts[3] || '0');
          }
        }

        // Si aún no tenemos dimensiones, usar un tamaño predeterminado
        const targetWidth = svgWidth || 800;
        const targetHeight = svgHeight || 800;

        console.log("📏 SVG dimensions detected:", targetWidth, "x", targetHeight);

        // Crear data URL del SVG
        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;

        // Cargar SVG en una imagen
        const tempImg = new Image();
        await new Promise<void>((resolve, reject) => {
          tempImg.onload = () => resolve();
          tempImg.onerror = () => reject(new Error('No se pudo cargar el SVG'));
          tempImg.src = svgDataUrl;
        });

        console.log("✅ SVG image loaded, using dimensions:", targetWidth, "x", targetHeight);

        // Rasterizar a PNG con las dimensiones especificadas
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          throw new Error('No se pudo crear contexto 2D');
        }

        // Fill with white background first (SVGs may have transparent areas)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetWidth, targetHeight);

        // Dibujar el SVG en el tamaño especificado
        ctx.drawImage(tempImg, 0, 0, targetWidth, targetHeight);
        pngDataUrl = canvas.toDataURL('image/png');
        console.log('📦 SVG converted to PNG data URL, length:', pngDataUrl.length);

      } else {
        // Para PNG/JPG, usar createImageBitmap (más rápido)
        console.log("🖼️ Raster image detected, using ImageBitmap...");

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

        pngDataUrl = canvas.toDataURL('image/png');
        console.log('📦 PNG data URL created directly, length:', pngDataUrl.length);
      }

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

        // set default frame TRULY centered
        const qrSize = Math.round(Math.min(img.naturalWidth, img.naturalHeight) * 0.3); // 30% del lado menor
        const defaultFrame = {
          x: Math.round((img.naturalWidth - qrSize) / 2),   // Centrado horizontalmente
          y: Math.round((img.naturalHeight - qrSize) / 2),  // Centrado verticalmente
          w: qrSize,
          h: qrSize
        };

        console.log("🎯 SETTING CENTERED FRAME:", defaultFrame);
        console.log("🎯 Image dimensions:", { width: img.naturalWidth, height: img.naturalHeight });
        console.log("🎯 QR should be centered at:", {
          centerX: defaultFrame.x + defaultFrame.w / 2,
          centerY: defaultFrame.y + defaultFrame.h / 2
        });
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
        isBold,
        isItalic,
        fontFamily,
        textAlign,
        lineHeight,
        letterSpacing
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

      console.log('=== FINAL EXPORT DEBUG ===');
      console.log('Template image natural size:', templateImage ? {
        width: templateImage.naturalWidth,
        height: templateImage.naturalHeight
      } : 'No custom template');
      console.log('Template size setting:', activeTemplate.size);
      console.log('Final activeTemplate.frame:', activeTemplate.frame);
      console.log('Final activeTemplate.labelBox:', activeTemplate.labelBox);
      console.log('==========================')

      let entries: Array<{ nombre: string; blob: Blob }> = [];

      try {
        const renderOptions = {
          textColor,
          isTransparentBackground,
          fontSize,
          isBold,
          isItalic,
          fontFamily,
          textAlign,
          lineHeight,
          letterSpacing
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
      reader.onload = function () {
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

  // Función para exportar PDF de impresión con marcas de corte
  const handleExportPrintPDF = useCallback(async () => {
    if (workItems.length === 0) {
      setStatus({ type: "error", text: "No hay elementos para exportar." });
      return;
    }

    // Inicializar modal
    setExportModal({
      isOpen: true,
      progress: 0,
      status: 'Preparando PDF de impresión...',
      canCancel: true,
      error: undefined
    });

    try {
      setExportModal(prev => ({
        ...prev,
        progress: 30,
        status: 'Generando PDF con marcas de corte...'
      }));

      // Calcular dimensiones de salida según el preset
      let outputWidthCm = 0;
      let outputHeightCm = 0;
      
      if (sizePreset === 'original') {
        // Mantener tamaño original (0, 0 indica uso de dimensiones de píxel)
        outputWidthCm = 0;
        outputHeightCm = 0;
      } else if (sizePreset === 'custom') {
        // Usar valores personalizados
        if (sizeUnit === 'cm') {
          outputWidthCm = customWidthCm;
          outputHeightCm = customHeightCm;
        } else {
          // Convertir px a cm (asumiendo 96 DPI para pantalla, 1 inch = 2.54 cm)
          outputWidthCm = (customWidthCm / 96) * 2.54;
          outputHeightCm = (customHeightCm / 96) * 2.54;
        }
      } else {
        // Usar preset predefinido
        outputWidthCm = SIZE_PRESETS[sizePreset].width;
        outputHeightCm = SIZE_PRESETS[sizePreset].height;
      }

      const renderOptions = {
        textColor,
        isTransparentBackground,
        fontSize,
        isBold,
        isItalic,
        fontFamily,
        textAlign,
        lineHeight,
        letterSpacing,
        outputWidthCm,
        outputHeightCm,
        showCropMarks,
        bleedMm
      };

      const pdfBlob = await exportPrintPDF(workItems, qrIndex, activeTemplate, renderOptions);

      setExportModal(prev => ({
        ...prev,
        progress: 90,
        status: 'Iniciando descarga...'
      }));

      // Convertir blob a data URL para descarga
      const reader = new FileReader();
      reader.onload = function () {
        const dataUrl = reader.result as string;
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = "plantilla_qrs_impresion.pdf";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setExportModal(prev => ({
          ...prev,
          progress: 100,
          status: `PDF de impresión generado con ${workItems.length} páginas`
        }));

        // Cerrar modal después de un breve delay
        setTimeout(() => {
          setExportModal(prev => ({ ...prev, isOpen: false }));
        }, 2000);
      };
      reader.readAsDataURL(pdfBlob);

      setStatus({ type: "info", text: `PDF de impresión generado con ${workItems.length} páginas.` });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportModal(prev => ({
        ...prev,
        error: `Error al generar PDF: ${message}`,
        canCancel: false
      }));
      setStatus({ type: "error", text: `Error al generar PDF: ${message}` });
    }
  }, [workItems, qrIndex, activeTemplate, textColor, isTransparentBackground, fontSize, isBold, isItalic, fontFamily, textAlign, lineHeight, letterSpacing, sizePreset, sizeUnit, customWidthCm, customHeightCm, showCropMarks, bleedMm]);

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
        <label
          className="dropzone-card"
          style={{
            ...styles.dropzone,
            ...(dragOver.csv && {
              borderColor: '#6366f1',
              boxShadow: '0 0 20px rgba(99, 102, 241, 0.4)',
              transform: 'scale(1.02)'
            })
          }}
          onDragEnter={(e) => { e.preventDefault(); setDragOver(prev => ({ ...prev, csv: true })); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(prev => ({ ...prev, csv: false })); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => setDragOver(prev => ({ ...prev, csv: false }))}
        >
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
        <label
          className="dropzone-card"
          style={{
            ...styles.dropzone,
            ...(dragOver.qr && {
              borderColor: '#6366f1',
              boxShadow: '0 0 20px rgba(99, 102, 241, 0.4)',
              transform: 'scale(1.02)'
            })
          }}
          onDragEnter={(e) => { e.preventDefault(); setDragOver(prev => ({ ...prev, qr: true })); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(prev => ({ ...prev, qr: false })); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => setDragOver(prev => ({ ...prev, qr: false }))}
        >
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
        <label
          className="dropzone-card"
          style={{
            ...styles.dropzone,
            ...(dragOver.template && {
              borderColor: '#6366f1',
              boxShadow: '0 0 20px rgba(99, 102, 241, 0.4)',
              transform: 'scale(1.02)'
            })
          }}
          onDragEnter={(e) => { e.preventDefault(); setDragOver(prev => ({ ...prev, template: true })); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(prev => ({ ...prev, template: false })); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => setDragOver(prev => ({ ...prev, template: false }))}
        >
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

      {/* Export Options Panel */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.95)',
        borderRadius: '16px',
        padding: '16px 20px',
        marginBottom: '16px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>Formato:</label>
            <select
              value={selectedExportFormat}
              onChange={(e) => {
                setSelectedExportFormat(e.target.value as any);
                setShowExportOptions(true);
              }}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid rgba(148, 163, 184, 0.3)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#f1f5f9',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              <option value="png">PNG (raster)</option>
              <option value="pdf">PDF (impresión)</option>
              <option value="svg">SVG (vectorial)</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => setShowExportOptions(!showExportOptions)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              background: 'transparent',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              color: '#94a3b8',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ⚙️ Opciones {showExportOptions ? '▲' : '▼'}
          </button>

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={selectedExportFormat === 'pdf' ? handleExportPrintPDF : handleExportZip}
            disabled={processing}
            style={{
              padding: '10px 24px',
              borderRadius: 10,
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: 'none',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: processing ? 'not-allowed' : 'pointer',
              opacity: processing ? 0.6 : 1,
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
            }}
          >
            {processing ? "Procesando..." : "📥 Descargar"}
          </button>

          <button type="button" className="secondary" onClick={handleClear} disabled={processing} style={{ padding: '10px 16px', borderRadius: 10 }}>
            Limpiar
          </button>
        </div>

        {showExportOptions && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500, display: 'block', marginBottom: '8px' }}>
                Tamaño de salida
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                {(Object.keys(SIZE_PRESETS) as SizePreset[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSizePreset(key)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: sizePreset === key ? '2px solid #6366f1' : '1px solid rgba(148, 163, 184, 0.3)',
                      background: sizePreset === key ? 'rgba(99, 102, 241, 0.15)' : 'rgba(15, 23, 42, 0.4)',
                      color: sizePreset === key ? '#a5b4fc' : '#94a3b8',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {SIZE_PRESETS[key].label}
                  </button>
                ))}
              </div>

              {sizePreset === 'custom' && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', background: 'rgba(15, 23, 42, 0.4)', padding: '12px 16px', borderRadius: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <label style={{ fontSize: 12, color: '#94a3b8' }}>Unidad:</label>
                    <select value={sizeUnit} onChange={(e) => setSizeUnit(e.target.value as SizeUnit)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(148, 163, 184, 0.3)', background: 'rgba(15, 23, 42, 0.6)', color: '#f1f5f9', fontSize: 13 }}>
                      <option value="cm">cm</option>
                      <option value="px">px</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <label style={{ fontSize: 12, color: '#94a3b8' }}>Ancho:</label>
                    <input type="number" value={customWidthCm} onChange={(e) => setCustomWidthCm(parseFloat(e.target.value) || 0)} step={sizeUnit === 'cm' ? 0.5 : 10} min={0} style={{ width: '70px', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(148, 163, 184, 0.3)', background: 'rgba(15, 23, 42, 0.6)', color: '#f1f5f9', fontSize: 13 }} />
                  </div>
                  <span style={{ color: '#64748b' }}>×</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <label style={{ fontSize: 12, color: '#94a3b8' }}>Alto:</label>
                    <input type="number" value={customHeightCm} onChange={(e) => setCustomHeightCm(parseFloat(e.target.value) || 0)} step={sizeUnit === 'cm' ? 0.5 : 10} min={0} style={{ width: '70px', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(148, 163, 184, 0.3)', background: 'rgba(15, 23, 42, 0.6)', color: '#f1f5f9', fontSize: 13 }} />
                  </div>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{sizeUnit}</span>
                </div>
              )}
            </div>

            {selectedExportFormat === 'pdf' && (
              <div style={{ background: 'rgba(15, 23, 42, 0.4)', padding: '12px 16px', borderRadius: 10 }}>
                <label style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500, display: 'block', marginBottom: '10px' }}>
                  Opciones de impresión
                </label>
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={showCropMarks} onChange={(e) => setShowCropMarks(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#6366f1' }} />
                    <span style={{ fontSize: 13, color: '#e2e8f0' }}>Marcas de corte y sangrado</span>
                  </label>
                  {showCropMarks && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <label style={{ fontSize: 12, color: '#94a3b8' }}>Sangrado:</label>
                      <input type="number" value={bleedMm} onChange={(e) => setBleedMm(parseFloat(e.target.value) || 0)} step={0.5} min={0} max={10} style={{ width: '50px', padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(148, 163, 184, 0.3)', background: 'rgba(15, 23, 42, 0.6)', color: '#f1f5f9', fontSize: 12 }} />
                      <span style={{ fontSize: 12, color: '#64748b' }}>mm</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
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
              const natW = img.naturalWidth || img.width;
              const natH = img.naturalHeight || img.height;
              const scale = natW > 0 && natH > 0 ? Math.min(imageRect.width / natW, imageRect.height / natH) : 1;
              const displayedW = natW * scale;
              const displayedH = natH * scale;
              const padLeft = (imageRect.width - displayedW) / 2;
              const padTop = (imageRect.height - displayedH) / 2;
              const x = e.clientX - imageRect.left - padLeft;
              const y = e.clientY - imageRect.top - padTop;
              const dragging = draggingRef.current;
              if (dragging && dragging.type === 'qr' && frame) {
                const newDisplayedX = x - dragging.offsetX;
                const newDisplayedY = y - dragging.offsetY;
                const newNatX = Math.round(newDisplayedX / scale);
                const newNatY = Math.round(newDisplayedY / scale);
                const finalX = Math.max(0, Math.min(newNatX, Math.round(natW - frame.w)));
                const finalY = Math.max(0, Math.min(newNatY, Math.round(natH - frame.h)));

                // Calcular si está centrado (con tolerancia de 5px)
                const centerX = finalX + frame.w / 2;
                const centerY = finalY + frame.h / 2;
                const canvasCenterX = natW / 2;
                const canvasCenterY = natH / 2;
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
                const finalX = Math.max(0, Math.min(newNatX, Math.round(natW - labelBox.w)));
                const finalY = Math.max(0, Math.min(newNatY, Math.round(natH - labelBox.h)));

                // Calcular si está centrado (con tolerancia de 5px)
                const centerX = finalX + labelBox.w / 2;
                const centerY = finalY + labelBox.h / 2;
                const canvasCenterX = natW / 2;
                const canvasCenterY = natH / 2;
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
                    const maxW = Math.max(8, Math.round(natW - baseFrame.x));
                    const maxH = Math.max(8, Math.round(natH - baseFrame.y));
                    if (keepSquare) {
                      const rawW = Math.round(resizing.startFrame.w + dx);
                      const rawH = Math.round(resizing.startFrame.h + dy);
                      const rawSize = Math.max(rawW, rawH);
                      const size = clamp(rawSize, 8, Math.min(maxW, maxH));
                      if (prev && prev.w === size && prev.h === size) return prev;
                      return { ...baseFrame, w: size, h: size };
                    } else {
                      const nextW = clamp(Math.round(resizing.startFrame.w + dx), 8, maxW);
                      const nextH = clamp(Math.round(resizing.startFrame.h + dy), 8, maxH);
                      if (prev && prev.w === nextW && prev.h === nextH) {
                        return prev;
                      }
                      return { ...baseFrame, w: nextW, h: nextH };
                    }
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
                    const maxW = Math.max(8, Math.round(natW - baseBox.x));
                    const maxH = Math.max(8, Math.round(natH - baseBox.y));
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
              const natW = img.naturalWidth || img.width;
              const natH = img.naturalHeight || img.height;
              const scale = natW > 0 && natH > 0 ? Math.min(imageRect.width / natW, imageRect.height / natH) : 1;
              const displayedW = natW * scale;
              const displayedH = natH * scale;
              const padLeft = (imageRect.width - displayedW) / 2;
              const padTop = (imageRect.height - displayedH) / 2;
              const offsetLeft = Math.round(imageRect.left - editorRect.left);
              const offsetTop = Math.round(imageRect.top - editorRect.top);
              const left = offsetLeft + Math.round(padLeft + frame.x * scale);
              const top = offsetTop + Math.round(padTop + frame.y * scale);
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
                    const imgEl = imageRef.current;
                    if (!imgEl) return;
                    const imageRect2 = imgEl.getBoundingClientRect();
                    const natW2 = imgEl.naturalWidth || imgEl.width;
                    const natH2 = imgEl.naturalHeight || imgEl.height;
                    const scale2 = natW2 > 0 && natH2 > 0 ? Math.min(imageRect2.width / natW2, imageRect2.height / natH2) : 1;
                    const displayedW2 = natW2 * scale2;
                    const displayedH2 = natH2 * scale2;
                    const padLeft2 = (imageRect2.width - displayedW2) / 2;
                    const padTop2 = (imageRect2.height - displayedH2) / 2;
                    draggingRef.current = {
                      type: 'qr',
                      offsetX: e.clientX - imageRect2.left - padLeft2 - Math.round(frame.x * scale2),
                      offsetY: e.clientY - imageRect2.top - padTop2 - Math.round(frame.y * scale2),
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
                      const imgEl = imageRef.current;
                      if (!imgEl) return;
                      const imageRect2 = imgEl.getBoundingClientRect();
                      const natW2 = imgEl.naturalWidth || imgEl.width;
                      const natH2 = imgEl.naturalHeight || imgEl.height;
                      const scale2 = natW2 > 0 && natH2 > 0 ? Math.min(imageRect2.width / natW2, imageRect2.height / natH2) : 1;
                      const displayedW2 = natW2 * scale2;
                      const displayedH2 = natH2 * scale2;
                      const padLeft2 = (imageRect2.width - displayedW2) / 2;
                      const padTop2 = (imageRect2.height - displayedH2) / 2;
                      e.stopPropagation();
                      e.preventDefault();
                      resizingRef.current = {
                        target: 'qr',
                        startX: e.clientX - imageRect2.left - padLeft2,
                        startY: e.clientY - imageRect2.top - padTop2,
                        startFrame: { ...frame },
                      };
                    }}
                    style={{ position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, background: '#00a', cursor: 'nwse-resize' }}
                  />
                </div>
              );
            })()}

            {labelBox && imageRef.current && (() => {
              // console.log("🏷️ DEBUG: LabelBox rendering:", labelBox, "fontSize:", fontSize, "isBold:", isBold);
              const img = imageRef.current!;
              const imageRect = img.getBoundingClientRect();
              const editorRect = editorRef.current!.getBoundingClientRect();
              const natW = img.naturalWidth || img.width;
              const natH = img.naturalHeight || img.height;
              const scale = natW > 0 && natH > 0 ? Math.min(imageRect.width / natW, imageRect.height / natH) : 1;
              const displayedW = natW * scale;
              const displayedH = natH * scale;
              const padLeft = (imageRect.width - displayedW) / 2;
              const padTop = (imageRect.height - displayedH) / 2;
              const offsetLeft = Math.round(imageRect.left - editorRect.left);
              const offsetTop = Math.round(imageRect.top - editorRect.top);
              const left = offsetLeft + Math.round(padLeft + labelBox.x * scale);
              const top = offsetTop + Math.round(padTop + labelBox.y * scale);
              const width = Math.round(labelBox.w * scale);
              const height = Math.round(labelBox.h * scale);
              // console.log("🏷️ DEBUG: Position:", { left, top, width, height });

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
                    const imgEl = imageRef.current;
                    if (!imgEl) return;
                    const imageRect2 = imgEl.getBoundingClientRect();
                    const natW2 = imgEl.naturalWidth || imgEl.width;
                    const natH2 = imgEl.naturalHeight || imgEl.height;
                    const scale2 = natW2 > 0 && natH2 > 0 ? Math.min(imageRect2.width / natW2, imageRect2.height / natH2) : 1;
                    const displayedW2 = natW2 * scale2;
                    const displayedH2 = natH2 * scale2;
                    const padLeft2 = (imageRect2.width - displayedW2) / 2;
                    const padTop2 = (imageRect2.height - displayedH2) / 2;
                    draggingRef.current = {
                      type: 'label',
                      offsetX: e.clientX - imageRect2.left - padLeft2 - Math.round(labelBox.x * scale2),
                      offsetY: e.clientY - imageRect2.top - padTop2 - Math.round(labelBox.y * scale2),
                    };
                  }}
                >
                  <input
                    style={{
                      width: '100%',
                      border: 'none',
                      outline: 'none',
                      textAlign: textAlign,
                      fontSize: `${fontSize}px`,
                      fontWeight: isBold ? 'bold' : 'normal',
                      fontStyle: isItalic ? 'italic' : 'normal',
                      fontFamily: fontFamily,
                      letterSpacing: `${letterSpacing}px`,
                      lineHeight: lineHeight,
                      color: textColor,
                      backgroundColor: 'transparent'
                    }}
                    value={labelBox.text}
                    onChange={(e) => setLabelBox({ ...labelBox, text: e.target.value })}
                  />
                  <div
                    onMouseDown={(e) => {
                      const imgEl = imageRef.current;
                      if (!imgEl) return;
                      const imageRect2 = imgEl.getBoundingClientRect();
                      const natW2 = imgEl.naturalWidth || imgEl.width;
                      const natH2 = imgEl.naturalHeight || imgEl.height;
                      const scale2 = natW2 > 0 && natH2 > 0 ? Math.min(imageRect2.width / natW2, imageRect2.height / natH2) : 1;
                      const displayedW2 = natW2 * scale2;
                      const displayedH2 = natH2 * scale2;
                      const padLeft2 = (imageRect2.width - displayedW2) / 2;
                      const padTop2 = (imageRect2.height - displayedH2) / 2;
                      e.stopPropagation();
                      e.preventDefault();
                      resizingRef.current = {
                        target: 'label',
                        startX: e.clientX - imageRect2.left - padLeft2,
                        startY: e.clientY - imageRect2.top - padTop2,
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
              const natW = img.naturalWidth || img.width;
              const natH = img.naturalHeight || img.height;
              const scale = natW > 0 && natH > 0 ? Math.min(imageRect.width / natW, imageRect.height / natH) : 1;
              const displayedW = natW * scale;
              const displayedH = natH * scale;
              const padLeft = (imageRect.width - displayedW) / 2;
              const padTop = (imageRect.height - displayedH) / 2;
              const offsetLeft = Math.round(imageRect.left - editorRect.left);
              const offsetTop = Math.round(imageRect.top - editorRect.top);

              return (
                <>
                  {/* Guía horizontal (línea vertical) */}
                  {showGuides.horizontal && (
                    <div
                      style={{
                        position: 'absolute',
                        left: offsetLeft + Math.round(padLeft + (natW / 2) * scale),
                        top: offsetTop + Math.round(padTop),
                        width: '1px',
                        height: Math.round(displayedH),
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
                        left: offsetLeft + Math.round(padLeft),
                        top: offsetTop + Math.round(padTop + (natH / 2) * scale),
                        width: Math.round(displayedW),
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
                  value={frameInputs.x ?? (frame ? String(frame.x) : '')}
                  onChange={handleFrameInputChange('x')}
                  onBlur={handleFrameInputBlur('x')}
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
                  value={frameInputs.y ?? (frame ? String(frame.y) : '')}
                  onChange={handleFrameInputChange('y')}
                  onBlur={handleFrameInputBlur('y')}
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
                  value={frameInputs.w ?? (frame ? String(frame.w) : '')}
                  onChange={handleFrameInputChange('w')}
                  onBlur={handleFrameInputBlur('w')}
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
                  value={frameInputs.h ?? (frame ? String(frame.h) : '')}
                  onChange={handleFrameInputChange('h')}
                  onBlur={handleFrameInputBlur('h')}
                  min={8}
                  step={1}
                  disabled={!frame}
                  style={styles.editorFieldInput}
                />
              </label>
              <label style={{ ...styles.editorField, flexDirection: 'row', alignItems: 'center', gap: '8px', minWidth: 'auto' }}>
                <input
                  type="checkbox"
                  checked={keepSquare}
                  onChange={(e) => setKeepSquare(e.target.checked)}
                  disabled={!frame}
                  style={{ margin: 0 }}
                />
                <span style={styles.editorFieldLabel}>Mantener cuadrado</span>
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
                <span style={styles.editorFieldLabel}>Fuente</span>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  disabled={!labelBox}
                  style={{ ...styles.editorFieldInput, minWidth: '110px' }}
                >
                  <option value="Inter">Inter</option>
                  <option value="Roboto">Roboto</option>
                  <option value="Montserrat">Montserrat</option>
                  <option value="Open Sans">Open Sans</option>
                  <option value="Playfair Display">Playfair Display</option>
                  <option value="Arial">Arial</option>
                </select>
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
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setIsBold(!isBold)}
                  disabled={!labelBox}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: isBold ? '2px solid #6366f1' : '1px solid rgba(148, 163, 184, 0.3)',
                    background: isBold ? 'rgba(99, 102, 241, 0.2)' : 'rgba(15, 23, 42, 0.6)',
                    color: isBold ? '#a5b4fc' : '#94a3b8',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: labelBox ? 'pointer' : 'not-allowed',
                    opacity: labelBox ? 1 : 0.5,
                  }}
                  title="Negrita"
                >
                  B
                </button>
                <button
                  type="button"
                  onClick={() => setIsItalic(!isItalic)}
                  disabled={!labelBox}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: isItalic ? '2px solid #6366f1' : '1px solid rgba(148, 163, 184, 0.3)',
                    background: isItalic ? 'rgba(99, 102, 241, 0.2)' : 'rgba(15, 23, 42, 0.6)',
                    color: isItalic ? '#a5b4fc' : '#94a3b8',
                    fontStyle: 'italic',
                    fontSize: 14,
                    cursor: labelBox ? 'pointer' : 'not-allowed',
                    opacity: labelBox ? 1 : 0.5,
                  }}
                  title="Cursiva"
                >
                  I
                </button>
              </div>
              <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setTextAlign('left')}
                  disabled={!labelBox}
                  style={{
                    padding: '6px 8px',
                    borderRadius: '6px 0 0 6px',
                    border: textAlign === 'left' ? '2px solid #6366f1' : '1px solid rgba(148, 163, 184, 0.3)',
                    background: textAlign === 'left' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(15, 23, 42, 0.6)',
                    color: textAlign === 'left' ? '#a5b4fc' : '#94a3b8',
                    fontSize: 12,
                    cursor: labelBox ? 'pointer' : 'not-allowed',
                    opacity: labelBox ? 1 : 0.5,
                  }}
                  title="Alinear izquierda"
                >
                  ⬅
                </button>
                <button
                  type="button"
                  onClick={() => setTextAlign('center')}
                  disabled={!labelBox}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 0,
                    border: textAlign === 'center' ? '2px solid #6366f1' : '1px solid rgba(148, 163, 184, 0.3)',
                    background: textAlign === 'center' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(15, 23, 42, 0.6)',
                    color: textAlign === 'center' ? '#a5b4fc' : '#94a3b8',
                    fontSize: 12,
                    cursor: labelBox ? 'pointer' : 'not-allowed',
                    opacity: labelBox ? 1 : 0.5,
                  }}
                  title="Centrar"
                >
                  ⬛
                </button>
                <button
                  type="button"
                  onClick={() => setTextAlign('right')}
                  disabled={!labelBox}
                  style={{
                    padding: '6px 8px',
                    borderRadius: '0 6px 6px 0',
                    border: textAlign === 'right' ? '2px solid #6366f1' : '1px solid rgba(148, 163, 184, 0.3)',
                    background: textAlign === 'right' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(15, 23, 42, 0.6)',
                    color: textAlign === 'right' ? '#a5b4fc' : '#94a3b8',
                    fontSize: 12,
                    cursor: labelBox ? 'pointer' : 'not-allowed',
                    opacity: labelBox ? 1 : 0.5,
                  }}
                  title="Alinear derecha"
                >
                  ➡
                </button>
              </div>
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
              <label style={{ ...styles.editorField, flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={isTransparentBackground}
                  onChange={(e) => setIsTransparentBackground(e.target.checked)}
                  disabled={!labelBox}
                  style={{ margin: 0 }}
                />
                <span style={styles.editorFieldLabel}>Fondo transparente</span>
              </label>
              <label style={styles.editorField}>
                <span style={styles.editorFieldLabel}>Interlineado</span>
                <select
                  value={lineHeight}
                  onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                  disabled={!labelBox}
                  style={styles.editorFieldInput}
                >
                  <option value={1}>1.0</option>
                  <option value={1.2}>1.2</option>
                  <option value={1.5}>1.5</option>
                  <option value={2}>2.0</option>
                </select>
              </label>
              <label style={styles.editorField}>
                <span style={styles.editorFieldLabel}>Espaciado</span>
                <select
                  value={letterSpacing}
                  onChange={(e) => setLetterSpacing(parseFloat(e.target.value))}
                  disabled={!labelBox}
                  style={styles.editorFieldInput}
                >
                  <option value={-1}>Apretado</option>
                  <option value={0}>Normal</option>
                  <option value={1}>Amplio</option>
                  <option value={2}>Muy amplio</option>
                </select>
              </label>
              <button
                type="button"
                onClick={resetTextDefaults}
                disabled={!labelBox}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: '#fca5a5',
                  fontSize: 12,
                  cursor: labelBox ? 'pointer' : 'not-allowed',
                  opacity: labelBox ? 1 : 0.5,
                }}
                title="Restaurar valores por defecto"
              >
                ↺ Reset
              </button>
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
    gap: "1.5rem",
    fontFamily: "var(--font-sans)",
  },
  dropzones: {
    display: "flex",
    flexWrap: "wrap",
    gap: "1rem",
  },
  dropzone: {
    flex: "1 1 260px",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "16px",
    padding: "1.5rem",
    position: "relative",
    minHeight: "130px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    background: "rgba(30, 41, 59, 0.7)",
    color: "var(--color-foreground)",
    backdropFilter: "blur(20px)",
    boxShadow: "0 8px 32px -8px rgba(0, 0, 0, 0.3)",
    transition: "all 0.3s ease",
  },
  dropzoneHint: {
    marginTop: "0.5rem",
    fontSize: "0.85rem",
    color: "#94a3b8",
    lineHeight: 1.5,
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
    background: "rgba(30, 41, 59, 0.85)",
    borderRadius: "16px",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    padding: "1.5rem",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    boxShadow: "0 8px 32px -8px rgba(0, 0, 0, 0.3)",
    backdropFilter: "blur(20px)",
  },
  editorMeta: {
    fontSize: "0.85rem",
    color: "#94a3b8",
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
    fontSize: "0.9rem",
    color: "#e2e8f0",
    letterSpacing: "0.01em",
  },
  editorField: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    minWidth: "85px",
  },
  editorFieldLabel: {
    fontSize: "0.75rem",
    color: "#94a3b8",
    fontWeight: 500,
  },
  editorFieldInput: {
    width: "100%",
    padding: "0.4rem 0.6rem",
    border: "1px solid rgba(148, 163, 184, 0.3)",
    borderRadius: "8px",
    fontSize: "0.85rem",
    background: "rgba(15, 23, 42, 0.6)",
    color: "#f1f5f9",
  },
  status: {
    padding: "0.85rem 1.25rem",
    borderRadius: "12px",
    backgroundColor: "rgba(30, 41, 59, 0.9)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    boxShadow: "0 4px 16px -4px rgba(0, 0, 0, 0.2)",
  },
  content: {
    display: "flex",
    flexWrap: "wrap",
    gap: "1.25rem",
  },
  preview: {
    flex: "1 1 280px",
    minWidth: "260px",
    background: "rgba(30, 41, 59, 0.7)",
    borderRadius: "16px",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    padding: "1.25rem",
    boxShadow: "0 8px 32px -8px rgba(0, 0, 0, 0.3)",
    backdropFilter: "blur(20px)",
  },
  previewImage: {
    width: "100%",
    height: "auto",
    borderRadius: "12px",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    boxShadow: "0 8px 24px -8px rgba(0, 0, 0, 0.4)",
  },
  previewPlaceholder: {
    padding: "2rem 1.5rem",
    textAlign: "center",
    color: "#64748b",
    border: "1px dashed rgba(148, 163, 184, 0.3)",
    borderRadius: "12px",
    background: "rgba(15, 23, 42, 0.4)",
  },
  mappingPanel: {
    border: "1px solid rgba(255, 255, 255, 0.1)",
    padding: "1rem",
    borderRadius: "16px",
    background: "rgba(30, 41, 59, 0.7)",
    boxShadow: "0 8px 32px -8px rgba(0, 0, 0, 0.3)",
    backdropFilter: "blur(20px)",
  },
  mappingRow: {
    display: "flex",
    gap: "0.75rem",
    alignItems: "center",
    flexWrap: "wrap",
  },
  smallLabel: {
    fontSize: "0.85rem",
    color: "#94a3b8",
    fontWeight: 500,
  },
  tableWrapper: {
    flex: "2 1 400px",
    minWidth: "320px",
    background: "rgba(30, 41, 59, 0.7)",
    borderRadius: "16px",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    padding: "1.25rem",
    overflow: "auto",
    boxShadow: "0 8px 32px -8px rgba(0, 0, 0, 0.3)",
    backdropFilter: "blur(20px)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
    padding: "0.6rem 0.75rem",
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    fontWeight: 600,
    fontSize: "0.85rem",
    color: "#e2e8f0",
  },
  td: {
    padding: "0.6rem 0.75rem",
    borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
    verticalAlign: "top",
    wordBreak: "break-word",
    color: "#cbd5e1",
    fontSize: "0.85rem",
  },
};

export default EmplantilladorQR;
