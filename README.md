# PlantillaAutoQR

Este repositorio contiene **dos entregables mantenidos**:

1. **Aplicación local (Tkinter)** para ajustar plantillas, escalar QRs manualmente, añadir textos y guardar configuraciones.
2. **Librería web (React/TypeScript)** con el componente `EmplantilladorQR` para automatizar el proceso desde el navegador.

Al limpiar los prototipos antiguos sólo queda un punto de entrada para cada versión, descrito a continuación para evitar confusiones.

> 📋 **Gestión de Entornos**: Si necesitas duplicar este repositorio para crear entornos separados de staging y producción, consulta la [Guía de Duplicación de Repositorio](./GUIA_DUPLICACION_REPOSITORIO.md).

## 1. Estructura principal

```
PlantillaAutoQR_Proyecto/
├── src/        # Código de la aplicación de escritorio (Tkinter)
├── assets/     # Recursos de ejemplo (imágenes, fuentes, QRs)
├── configs/    # Configuraciones guardadas de ejemplo en JSON
├── build/, dist/  # Artefactos generados por PyInstaller
└── web/        # Librería React/TypeScript
```

> 🛈 No hay otras versiones vigentes: si encuentras documentación antigua que hable de `main2.py`, `main3.py` o scripts en `legacy/`, ignórala porque fueron eliminados.

## 2. Aplicación local (Tkinter)

### Requisitos

- Python 3.10 o superior.
- Dependencias listadas en `requirements.txt`.

### Instalación

```bash
pip install -r PlantillaAutoQR_Proyecto/requirements.txt
```

### Ejecución

Desde la raíz del repositorio abre la interfaz moderna ejecutando el **único** punto de entrada del escritorio:

```bash
python PlantillaAutoQR_Proyecto/src/app.py
```

Ese script delega en la clase `QRTool` definida en `src/main.py`, que es la versión con:

- Redimensionamiento manual del QR sobre la plantilla.
- Inclusión de textos personalizados.
- Gestión de configuraciones (`.json`) para reutilizar ajustes.

Si prefieres mantener el terminal dentro de `src/`, puedes usar:

```bash
cd PlantillaAutoQR_Proyecto/src
python -m app
```

> 💡 En Windows también puedes ejecutar el binario generado en `dist/PlantillaAutoQR/PlantillaAutoQR.exe` si necesitas la versión empaquetada.

## 3. Librería web (React/TypeScript)

La carpeta `PlantillaAutoQR_Proyecto/web` distribuye el componente `EmplantilladorQR`. Está pensado para integrarse en proyectos propios, no para abrir una SPA independiente.

### Dependencias

```bash
cd PlantillaAutoQR_Proyecto/web
npm install
```

### Scripts disponibles

- `npm run dev`: arranca el entorno de desarrollo (Vite) para probar el componente.
- `npm run build`: genera la librería compilada en `dist/`.

### Uso básico

```tsx
import templateImage from "./plantilla.png";
import { EmplantilladorQR, TemplateDef } from "plantilla-auto-qr-web";

const template: TemplateDef = {
  baseImage: templateImage,
  frame: { x: 820, y: 540, w: 520, h: 520 },
  exportFormat: "png",
};

export function Demo() {
  return <EmplantilladorQR template={template} />;
}
```

El componente admite:

1. CSV opcional con las columnas `numero`, `enlace` y `nombreArchivoSalida`.
2. Carpeta con QRs (`.png` o `.svg`) para mapear por nombre.
3. Vista previa del primer elemento antes de procesar.
4. Exportación masiva con control de formato (PNG o PDF).

### Reglas de resolución

- Los QRs subidos tienen prioridad sobre los generados.
- Si falta `enlace` y tampoco hay QR subido, el elemento se marca como error.
- Los SVG se rasterizan al tamaño del marco antes de insertarse.
- Los QRs generados no incluyen quiet zone, usan fondo transparente y corrección de errores **M**.
- Cada elemento exportado adopta el `nombreArchivoSalida` (o `numero` si está vacío).

### Registro y estado

La tabla de la interfaz web muestra `numero`, `enlace`, `nombreArchivoSalida`, `origenQR` (`subido`/`generado`) y el resultado (`ok`/`error`/`pendiente`). También se actualiza una banda de estado con mensajes informativos durante el proceso.
