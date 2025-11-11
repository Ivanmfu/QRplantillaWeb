# Guía para Duplicar el Repositorio: Entornos de Staging y Producción

Esta guía describe diferentes estrategias **seguras** para duplicar tu repositorio `QRplantillaWeb` y crear entornos separados de staging (pruebas) y producción, sin correr riesgos.

## Tabla de Contenidos

1. [Opciones Disponibles](#opciones-disponibles)
2. [Opción Recomendada: Dos Repositorios Separados](#opción-recomendada-dos-repositorios-separados)
3. [Alternativa: Un Solo Repositorio con Branches](#alternativa-un-solo-repositorio-con-branches)
4. [Configuración de Despliegues](#configuración-de-despliegues)
5. [Mejores Prácticas](#mejores-prácticas)

---

## Opciones Disponibles

### 1. **Dos Repositorios Separados** (Recomendado para máxima seguridad)
- Un repositorio para staging: `QRplantillaWeb-staging`
- Un repositorio para producción: `QRplantillaWeb-production`

### 2. **Un Solo Repositorio con Branches Protegidas**
- Branch `staging` para pruebas
- Branch `main` o `production` para producción

### 3. **Fork del Repositorio**
- Usar fork para staging y el original para producción

---

## Opción Recomendada: Dos Repositorios Separados

Esta opción proporciona **máxima seguridad** porque los cambios en staging no pueden afectar accidentalmente a producción.

### Paso 1: Crear el Repositorio de Staging

#### Opción A: Duplicar usando GitHub (Recomendado)

1. **Crear un nuevo repositorio vacío en GitHub:**
   - Ve a https://github.com/new
   - Nombre: `QRplantillaWeb-staging`
   - **NO** inicialices con README, .gitignore o licencia
   - Haz clic en "Create repository"

2. **Hacer un mirror (espejo) del repositorio actual:**

   ```bash
   # Clonar el repositorio original como espejo (bare clone)
   git clone --bare https://github.com/Ivanmfu/QRplantillaWeb.git
   
   # Entrar al directorio clonado
   cd QRplantillaWeb.git
   
   # Hacer push al nuevo repositorio de staging
   git push --mirror https://github.com/Ivanmfu/QRplantillaWeb-staging.git
   
   # Limpiar
   cd ..
   rm -rf QRplantillaWeb.git
   ```

3. **Clonar el nuevo repositorio de staging para trabajar:**

   ```bash
   git clone https://github.com/Ivanmfu/QRplantillaWeb-staging.git
   cd QRplantillaWeb-staging
   ```

#### Opción B: Usar GitHub Template

1. Ve a tu repositorio original en GitHub
2. Haz clic en "Settings"
3. Marca la opción "Template repository"
4. Luego ve a https://github.com/Ivanmfu/QRplantillaWeb
5. Haz clic en "Use this template" → "Create a new repository"
6. Nombre: `QRplantillaWeb-staging`

### Paso 2: Renombrar el Repositorio Original como Producción

1. **Opción segura - Crear nuevo repositorio de producción:**

   ```bash
   # Crear repositorio nuevo vacío en GitHub llamado: QRplantillaWeb-production
   
   # Hacer mirror del repositorio original
   git clone --bare https://github.com/Ivanmfu/QRplantillaWeb.git
   cd QRplantillaWeb.git
   git push --mirror https://github.com/Ivanmfu/QRplantillaWeb-production.git
   cd ..
   rm -rf QRplantillaWeb.git
   ```

2. **Opción alternativa - Renombrar el repositorio existente:**
   - Ve a https://github.com/Ivanmfu/QRplantillaWeb/settings
   - En "Repository name", cambia a `QRplantillaWeb-production`
   - Haz clic en "Rename"
   
   ⚠️ **Advertencia:** Esto romperá los links existentes y requiere actualizar los remotes locales:
   
   ```bash
   git remote set-url origin https://github.com/Ivanmfu/QRplantillaWeb-production.git
   ```

### Paso 3: Configurar Variables de Entorno

En cada repositorio, configura variables específicas del entorno:

1. Ve a Settings → Secrets and variables → Actions
2. Añade variables/secrets según necesites:
   - `ENVIRONMENT_NAME`: "staging" o "production"
   - API keys diferentes para cada entorno
   - URLs de despliegue diferentes

---

## Alternativa: Un Solo Repositorio con Branches

Si prefieres mantener un solo repositorio, usa branches protegidas:

### Configuración

1. **Crear branch de staging:**

   ```bash
   # Desde tu repositorio local
   git checkout -b staging
   git push -u origin staging
   ```

2. **Proteger branches en GitHub:**

   - Ve a Settings → Branches → Add rule
   - Para `main` (producción):
     - Require pull request reviews before merging
     - Require status checks to pass
     - Include administrators
   - Repetir para `staging`

3. **Workflow de trabajo:**

   ```
   feature-branch → staging (PR) → pruebas → main (PR) → producción
   ```

### Ventajas y Desventajas

**Ventajas:**
- Un solo repositorio para mantener
- Historial de git unificado
- Fácil sincronización entre entornos

**Desventajas:**
- Menos aislamiento entre entornos
- Posibilidad de merge accidental a producción
- Configuraciones compartidas pueden causar confusión

---

## Configuración de Despliegues

### GitHub Actions para Despliegues Automáticos

Crea workflows separados para cada entorno:

#### `.github/workflows/deploy-staging.yml`

```yaml
name: Deploy to Staging

on:
  push:
    branches: [ main, staging ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: |
          cd web
          npm ci
      
      - name: Build
        run: |
          cd web
          npm run build
        env:
          VITE_ENV: staging
      
      - name: Deploy to Staging Server
        run: |
          echo "Desplegando a staging..."
          # Añade tus comandos de despliegue aquí
```

#### `.github/workflows/deploy-production.yml`

```yaml
name: Deploy to Production

on:
  release:
    types: [published]
  workflow_dispatch:  # Permite despliegue manual

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: |
          cd web
          npm ci
      
      - name: Build
        run: |
          cd web
          npm run build
        env:
          VITE_ENV: production
      
      - name: Deploy to Production Server
        run: |
          echo "Desplegando a producción..."
          # Añade tus comandos de despliegue aquí
```

### Configurar Entornos en GitHub

1. Ve a Settings → Environments
2. Crea dos entornos:
   - **staging**: Sin protecciones especiales
   - **production**: 
     - Require reviewers (añade revisores de confianza)
     - Wait timer (opcional, ej: 5 minutos de espera)

---

## Mejores Prácticas

### 1. **Estrategia de Branches**

```
┌─────────────┐
│   feature   │  ← Desarrollo de nuevas funcionalidades
└──────┬──────┘
       ↓ PR
┌─────────────┐
│   staging   │  ← Pruebas e integración
└──────┬──────┘
       ↓ PR (después de pruebas exitosas)
┌─────────────┐
│    main     │  ← Producción estable
└─────────────┘
```

### 2. **Versionado Semántico**

- **Staging**: Usa versiones pre-release (ej: `1.2.0-beta.1`)
- **Production**: Usa versiones estables (ej: `1.2.0`)

```bash
# En staging
git tag -a v1.2.0-beta.1 -m "Release candidate para testing"
git push origin v1.2.0-beta.1

# En producción (después de pruebas)
git tag -a v1.2.0 -m "Versión de producción"
git push origin v1.2.0
```

### 3. **Variables de Entorno**

Crea archivos de configuración separados:

```
web/
├── .env.staging
├── .env.production
└── .env.example
```

En `.env.staging`:
```
VITE_API_URL=https://staging-api.tudominio.com
VITE_ENVIRONMENT=staging
```

En `.env.production`:
```
VITE_API_URL=https://api.tudominio.com
VITE_ENVIRONMENT=production
```

### 4. **Checklist Antes de Desplegar a Producción**

- [ ] Los cambios se probaron en staging
- [ ] Todas las pruebas pasan
- [ ] El código fue revisado (code review)
- [ ] La documentación está actualizada
- [ ] No hay secretos hardcodeados en el código
- [ ] Las variables de entorno están configuradas
- [ ] Hay un plan de rollback si algo falla

### 5. **Sincronización entre Entornos**

Si usas dos repositorios separados, sincroniza periódicamente:

```bash
# Desde el repositorio de staging
git remote add production https://github.com/Ivanmfu/QRplantillaWeb-production.git
git fetch production

# Para traer cambios de producción a staging (ej: hotfixes)
git merge production/main

# Para enviar cambios probados de staging a producción
# (Mejor hacer esto mediante PRs en GitHub)
```

### 6. **Protección contra Errores Comunes**

#### En el repositorio de producción:

Añade `.github/CODEOWNERS`:
```
# Requiere aprobación para cambios en producción
* @Ivanmfu @otro-reviewer
```

#### Branch protection rules:
- ✅ Require pull request before merging
- ✅ Require approvals: 1 (o más)
- ✅ Require status checks to pass
- ✅ Require branches to be up to date before merging
- ✅ Include administrators (para evitar bypass accidental)

---

## Resumen de Recomendaciones

### Para Máxima Seguridad (Recomendado):

1. **Crea dos repositorios separados:**
   - `QRplantillaWeb-staging`
   - `QRplantillaWeb-production`

2. **Workflow de desarrollo:**
   ```
   Desarrollo → Commit → Push a staging → Pruebas
   → Si todo OK → PR de staging a production → Deploy a producción
   ```

3. **Beneficios:**
   - ✅ Aislamiento total entre entornos
   - ✅ Imposible mergear accidentalmente a producción
   - ✅ Configuraciones completamente independientes
   - ✅ Permisos y accesos diferenciados

### Para Simplicidad (Alternativa):

1. **Un solo repositorio con branches protegidas:**
   - Branch `staging` para pruebas
   - Branch `main` para producción

2. **Workflow de desarrollo:**
   ```
   feature-branch → staging branch → pruebas → main branch → producción
   ```

3. **Beneficios:**
   - ✅ Un solo repositorio para mantener
   - ✅ Historial unificado
   - ✅ Más simple de gestionar

---

## Próximos Pasos

1. **Decide qué estrategia usar** (dos repositorios vs. branches)
2. **Implementa la duplicación** siguiendo los pasos de esta guía
3. **Configura workflows de CI/CD** para despliegues automáticos
4. **Prueba el flujo completo** con un cambio pequeño
5. **Documenta el proceso** para tu equipo

## Ayuda Adicional

Si necesitas ayuda específica con algún paso, no dudes en preguntar. Algunos temas comunes:

- Configuración de despliegues específicos (Vercel, Netlify, AWS, etc.)
- Configuración de variables de entorno
- Automatización de sincronización entre repositorios
- Configuración de CI/CD más avanzada

---

**Fecha de creación:** Noviembre 2025
**Versión:** 1.0
