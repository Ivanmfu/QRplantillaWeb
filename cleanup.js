// NUCLEAR CACHE CLEANUP v5.0.0 - Limpieza agresiva total
console.log('🧹 Starting NUCLEAR cache cleanup v5.0.0...');

// Service Worker Killer - Para limpiar cualquier cache anterior
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for(let registration of registrations) {
      registration.unregister();
      console.log('🗑️ Service Worker desregistrado:', registration);
    }
  });
}

// Limpiar todos los caches
if ('caches' in window) {
  caches.keys().then(function(names) {
    for (let name of names) {
      caches.delete(name);
      console.log('🗑️ Cache eliminado:', name);
    }
  });
}

// Limpiar localStorage y sessionStorage
try {
  // Verificar versión antes de limpiar
  const storedVersion = localStorage.getItem('app_version');
  if (storedVersion && storedVersion !== '5.0.0') {
    console.log('🔄 Versión antigua detectada:', storedVersion, '→ 5.0.0');
    localStorage.clear();
    sessionStorage.clear();
    console.log('✅ Storage limpiado por cambio de versión');
  }
} catch (e) {
  console.warn('⚠️ No se pudo verificar/limpiar storage:', e);
}

// Interceptar Image.prototype.src para detectar blob URLs
const originalImageDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
if (originalImageDescriptor && originalImageDescriptor.set) {
  const originalSetter = originalImageDescriptor.set;
  
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    set: function(value) {
      if (typeof value === 'string' && value.startsWith('blob:')) {
        console.error('🚨 BLOCKED: Attempt to set blob: URL on Image element!', value);
        console.error('📍 Stack:', new Error().stack);
        // Reemplazar con imagen transparente 1x1
        originalSetter.call(this, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
        return;
      }
      originalSetter.call(this, value);
    },
    get: originalImageDescriptor.get
  });
  
  console.log('✅ Image.src interceptor instalado');
}

console.log('✅ Cache cleanup completado v5.0.0');