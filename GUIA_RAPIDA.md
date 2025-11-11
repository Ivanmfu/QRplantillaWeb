# Guía Rápida: Duplicación de Repositorio

## Opción 1: Dos Repositorios Separados (RECOMENDADO) ⭐

### Paso a Paso

1. **Crear repositorio de staging en GitHub:**
   - Nombre: `QRplantillaWeb-staging`
   - No inicializar con archivos

2. **Duplicar el repositorio actual:**
   ```bash
   git clone --bare https://github.com/Ivanmfu/QRplantillaWeb.git
   cd QRplantillaWeb.git
   git push --mirror https://github.com/Ivanmfu/QRplantillaWeb-staging.git
   cd ..
   rm -rf QRplantillaWeb.git
   ```

3. **Crear repositorio de producción:**
   - Nombre: `QRplantillaWeb-production`
   - Repetir paso 2 con la nueva URL

4. **Configurar workflows:**
   - Copia `.github/workflows/deploy-staging.yml.example` → `deploy-staging.yml`
   - Copia `.github/workflows/deploy-production.yml.example` → `deploy-production.yml`
   - Personaliza según tu plataforma de despliegue

5. **Listo!** Ahora tienes:
   - 🟡 Staging: Para pruebas y desarrollo
   - 🟢 Production: Para código estable

---

## Opción 2: Un Solo Repositorio con Branches

### Paso a Paso

1. **Crear branch de staging:**
   ```bash
   git checkout -b staging
   git push -u origin staging
   ```

2. **Proteger branches en GitHub:**
   - Settings → Branches → Add rule
   - Proteger `main` y `staging`
   - Requerir pull requests y reviews

3. **Workflow:**
   ```
   develop → staging → pruebas → main → producción
   ```

---

## Workflow de Trabajo Diario

### Con Dos Repositorios

```bash
# Trabajar en staging
git clone https://github.com/Ivanmfu/QRplantillaWeb-staging.git
cd QRplantillaWeb-staging
# ... hacer cambios ...
git add .
git commit -m "Nueva funcionalidad"
git push

# Después de pruebas exitosas, promover a producción
# Crear PR desde staging a production en GitHub
```

### Con Branches

```bash
# Trabajar en feature
git checkout -b feature/nueva-funcionalidad
# ... hacer cambios ...
git add .
git commit -m "Nueva funcionalidad"
git push -u origin feature/nueva-funcionalidad

# Crear PR a staging → probar → PR a main
```

---

## Comandos Útiles

### Sincronizar cambios entre repositorios

```bash
# Desde staging, traer cambios de producción (ej: hotfixes)
git remote add production https://github.com/Ivanmfu/QRplantillaWeb-production.git
git fetch production
git merge production/main
```

### Crear release para producción

```bash
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

### Ver diferencias entre entornos

```bash
# Desde staging
git fetch production
git diff production/main
```

---

## Checklist Pre-Despliegue a Producción

- [ ] Probado en staging
- [ ] Tests pasando
- [ ] Code review completado
- [ ] Documentación actualizada
- [ ] Variables de entorno configuradas
- [ ] Sin secretos hardcodeados
- [ ] Plan de rollback preparado

---

## Ayuda Rápida

**¿Algo salió mal en producción?**
1. Identifica el último commit bueno: `git log`
2. Revierte: `git revert <commit-hash>`
3. O haz rollback a un tag anterior: `git checkout v1.0.0`

**¿Cómo sincronizo un hotfix de producción a staging?**
```bash
# Desde staging
git fetch production
git cherry-pick <commit-hash-del-hotfix>
git push
```

**¿Cómo veo qué está desplegado en cada entorno?**
```bash
git describe --tags  # Muestra el tag/versión actual
```

---

Para más detalles, consulta [GUIA_DUPLICACION_REPOSITORIO.md](./GUIA_DUPLICACION_REPOSITORIO.md)
