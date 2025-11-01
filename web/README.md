# Publicación manual (staging y producción)

Este proyecto usa Vite + React (TypeScript) en `web/`. El build de producción se emite en `dist/` en la raíz del repositorio (ver `web/vite.config.ts -> outDir: ../dist`).

A continuación tienes un checklist mínimo para publicar manualmente en GitHub Pages sin automatizaciones.

## Preparación

- Requisitos: Node 18+ y npm.
- Ramas:
  - `main`: código fuente.
  - `gh-pages`: artefactos publicados (HTML/CSS/JS en la raíz).
- Remotos:
  - `origin`: repositorio de staging.
  - `prod`: repositorio de producción (opcional si deseas un repos dedicado a prod).

## Paso a paso (publicación manual)

1) Compilar la app (desde la carpeta `web/`):

```bash
cd web
npm ci   # opcional la primera vez
npm run build
```

Esto generará el build en `../dist` (es decir, `dist/` en la raíz del repo).

2) Cambiar a la rama `gh-pages` en la raíz y publicar los artefactos:

```bash
cd ..  # volver a la raíz del repo
git checkout gh-pages
# Copiar el contenido de dist/ a la raíz de gh-pages (limpiando archivos antiguos)
rsync -a --delete dist/ ./
# Evitar que Jekyll interfiera (opcional, recomendable)
touch .nojekyll
# Commitear los cambios
git add -A
git commit -m "chore(deploy): publish web build"
```

3) Empujar a STAGING o PRODUCCIÓN según toque:

- Staging (origin):

```bash
git push origin gh-pages
```

- Producción (prod):

```bash
git push prod gh-pages
```

4) Configurar GitHub Pages (una sola vez por repositorio):

- Settings → Pages → Source: "Deploy from a branch"
- Branch: `gh-pages`, Folder: `/`
- Espera 1–2 minutos y comprueba la URL.

## Consejos

- Si la URL devuelve 404 tras publicar, revisa que la rama/carpeta de Pages está bien (gh-pages, `/`).
- Si usas reglas de protección en `gh-pages`, evita forzar reescrituras; el flujo anterior conserva historial.
- Para publicar solo en producción, omite el push a `origin` y usa solo `git push prod gh-pages`.

## Reversión rápida

Si necesitas volver al estado anterior en `gh-pages`:

```bash
git log --oneline
# Elige el commit anterior al despliegue
git reset --hard <SHA>
git push --force-with-lease <remote> gh-pages
```

(Usa `origin` o `prod` según el remoto que quieras revertir.)

---

¿Quieres volver a habilitar automatización (Actions o scripts locales)? Se puede añadir más adelante sin tocar el flujo manual.
# Publicación manual (staging y producción)

Este proyecto usa Vite + React (TypeScript) en `web/`. El build de producción se emite en `dist/` en la raíz del repositorio (ver `web/vite.config.ts -> outDir: ../dist`).

A continuación tienes un checklist mínimo para publicar manualmente en GitHub Pages sin automatizaciones.

## Preparación

- Requisitos: Node 18+ y npm.
- Ramas:
  - `main`: código fuente.
  - `gh-pages`: artefactos publicados (HTML/CSS/JS en la raíz).
- Remotos:
  - `origin`: repositorio de staging.
  - `prod`: repositorio de producción (opcional si deseas un repos dedicado a prod).

## Paso a paso (publicación manual)

1) Compilar la app (desde la carpeta `web/`):

```bash
cd web
npm ci   # opcional la primera vez
npm run build
```

Esto generará el build en `../dist` (es decir, `dist/` en la raíz del repo).

2) Cambiar a la rama `gh-pages` en la raíz y publicar los artefactos:

```bash
cd ..  # volver a la raíz del repo
git checkout gh-pages
# Copiar el contenido de dist/ a la raíz de gh-pages (limpiando archivos antiguos)
rsync -a --delete dist/ ./
# Evitar que Jekyll interfiera (opcional, recomendable)
touch .nojekyll
# Commitear los cambios
git add -A
git commit -m "chore(deploy): publish web build"
```

3) Empujar a STAGING o PRODUCCIÓN según toque:

- Staging (origin):

```bash
git push origin gh-pages
```

- Producción (prod):

```bash
git push prod gh-pages
```

4) Configurar GitHub Pages (una sola vez por repositorio):

- Settings → Pages → Source: "Deploy from a branch"
- Branch: `gh-pages`, Folder: `/`
- Espera 1–2 minutos y comprueba la URL.

## Consejos

- Si la URL devuelve 404 tras publicar, revisa que la rama/carpeta de Pages está bien (gh-pages, `/`).
- Si usas reglas de protección en `gh-pages`, evita forzar reescrituras; el flujo anterior conserva historial.
- Para publicar solo en producción, omite el push a `origin` y usa solo `git push prod gh-pages`.

## Reversión rápida

Si necesitas volver al estado anterior en `gh-pages`:

```bash
git log --oneline
# Elige el commit anterior al despliegue
git reset --hard <SHA>
git push --force-with-lease <remote> gh-pages
```

(Usa `origin` o `prod` según el remoto que quieras revertir.)

---

¿Quieres volver a habilitar automatización (Actions o scripts locales)? Se puede añadir más adelante sin tocar el flujo manual.