# Resumen de Cambios - Duplicación de Repositorio

## 📋 Qué se ha creado

Se han agregado los siguientes archivos al repositorio para ayudarte a duplicar el repositorio de forma segura y crear entornos separados de staging y producción:

### 📚 Documentación Principal

1. **GUIA_DUPLICACION_REPOSITORIO.md** (Guía Completa)
   - Explica dos estrategias principales: dos repositorios separados vs. branches protegidas
   - Instrucciones paso a paso para cada opción
   - Configuración de despliegues automáticos
   - Mejores prácticas y checklist de seguridad
   - Ejemplos de sincronización entre entornos
   
2. **GUIA_RAPIDA.md** (Referencia Rápida)
   - Comandos esenciales
   - Workflow de trabajo diario
   - Ayuda rápida para problemas comunes

### 🔧 Ejemplos de CI/CD

3. **.github/workflows/deploy-staging.yml.example**
   - Workflow para despliegues automáticos a staging
   - Se ejecuta en cada push a la rama staging
   - Incluye verificaciones de build y tests
   
4. **.github/workflows/deploy-production.yml.example**
   - Workflow para despliegues controlados a producción
   - Requiere confirmación manual ("DEPLOY")
   - Se ejecuta en releases o manualmente
   - Incluye validaciones adicionales de seguridad

### ⚙️ Configuración

5. **web/.env.example**
   - Plantilla para variables de entorno
   - NO incluye valores reales (solo ejemplos)
   - Usa esto para crear .env.staging y .env.production
   
6. **web/.gitignore** (Actualizado)
   - Protege archivos .env para evitar commitear secretos
   - Excluye node_modules y archivos de logs

### 📖 README Actualizado

7. **README.md**
   - Agregada referencia a la guía de duplicación

---

## 🚀 Próximos Pasos Recomendados

### Opción 1: Dos Repositorios Separados (Recomendado)

1. **Lee la guía completa:**
   ```bash
   cat GUIA_DUPLICACION_REPOSITORIO.md
   ```

2. **Crea el repositorio de staging en GitHub:**
   - Ir a https://github.com/new
   - Nombre: `QRplantillaWeb-staging`
   - No inicializar con archivos

3. **Duplica este repositorio:**
   ```bash
   git clone --bare https://github.com/Ivanmfu/QRplantillaWeb.git
   cd QRplantillaWeb.git
   git push --mirror https://github.com/Ivanmfu/QRplantillaWeb-staging.git
   cd ..
   rm -rf QRplantillaWeb.git
   ```

4. **Repite para producción:**
   - Crear repositorio: `QRplantillaWeb-production`
   - Hacer mirror del original

5. **Configura los workflows:**
   - En staging: copia `deploy-staging.yml.example` → `deploy-staging.yml`
   - En production: copia `deploy-production.yml.example` → `deploy-production.yml`
   - Personaliza según tu plataforma de despliegue (GitHub Pages, Vercel, etc.)

### Opción 2: Un Solo Repositorio con Branches

1. **Crea branch de staging:**
   ```bash
   git checkout -b staging
   git push -u origin staging
   ```

2. **Protege las branches en GitHub:**
   - Settings → Branches → Add rule
   - Proteger `main` y `staging`

3. **Configura workflows:**
   - Copia los archivos .example y personalízalos

---

## ⚠️ IMPORTANTE: Archivos .example

Los archivos con extensión `.example` son **plantillas** que debes:

1. **Copiar** sin el `.example`:
   ```bash
   cp .github/workflows/deploy-staging.yml.example .github/workflows/deploy-staging.yml
   cp .github/workflows/deploy-production.yml.example .github/workflows/deploy-production.yml
   ```

2. **Personalizar** según tu método de despliegue:
   - GitHub Pages
   - Vercel
   - Netlify
   - Servidor propio (SSH/FTP)

3. **Commitear** los archivos personalizados (sin .example)

---

## 🔒 Seguridad

### Variables de Entorno

**NUNCA** commitees archivos con valores reales:
- ❌ `.env`
- ❌ `.env.staging`
- ❌ `.env.production`

**SÍ** commitea:
- ✅ `.env.example` (solo plantilla, sin valores reales)

### Configuración en GitHub

Para variables sensibles, usa GitHub Secrets:
1. Settings → Secrets and variables → Actions
2. New repository secret
3. Añade: `STAGING_API_URL`, `PRODUCTION_API_URL`, etc.

---

## 📞 ¿Necesitas Ayuda?

Si tienes preguntas sobre algún paso específico:

1. **Revisa la guía completa:** `GUIA_DUPLICACION_REPOSITORIO.md`
2. **Consulta la guía rápida:** `GUIA_RAPIDA.md`
3. **Busca en la sección específica** de tu plataforma de despliegue

---

## ✅ Checklist Final

Antes de empezar:
- [ ] He leído la guía completa
- [ ] He decidido qué estrategia usar (2 repos vs branches)
- [ ] Tengo claro dónde voy a desplegar (GitHub Pages, Vercel, etc.)
- [ ] He entendido cómo funcionan las variables de entorno

Durante la implementación:
- [ ] He creado los repositorios necesarios
- [ ] He configurado los workflows
- [ ] He configurado las variables de entorno
- [ ] He probado un despliegue a staging
- [ ] Todo funciona correctamente

---

**Última actualización:** Noviembre 2025
