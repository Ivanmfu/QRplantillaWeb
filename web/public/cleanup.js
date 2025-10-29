// Service Worker Killer - Para limpiar cualquier cache anterior
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for(let registration of registrations) {
      registration.unregister();
      console.log('Service Worker desregistrado:', registration);
    }
  });
}

// Limpiar todos los caches
if ('caches' in window) {
  caches.keys().then(function(names) {
    for (let name of names) {
      caches.delete(name);
      console.log('Cache eliminado:', name);
    }
  });
}

// Limpiar localStorage y sessionStorage
try {
  localStorage.clear();
  sessionStorage.clear();
  console.log('Storage limpiado');
} catch (e) {
  console.warn('No se pudo limpiar storage:', e);
}

console.log('Cache cleanup completado');