// Gestor centralizado de blob URLs para evitar memory leaks y errores de revocación prematura
class BlobUrlManager {
  private static instance: BlobUrlManager;
  private urls = new Map<string, string>();
  
  static getInstance(): BlobUrlManager {
    if (!BlobUrlManager.instance) {
      BlobUrlManager.instance = new BlobUrlManager();
    }
    return BlobUrlManager.instance;
  }
  
  createUrl(blob: Blob, key?: string): string {
    const url = URL.createObjectURL(blob);
    const urlKey = key || url;
    
    // Si ya existe un URL para esta key, revocarlo
    const existingUrl = this.urls.get(urlKey);
    if (existingUrl) {
      URL.revokeObjectURL(existingUrl);
    }
    
    this.urls.set(urlKey, url);
    return url;
  }
  
  revokeUrl(key: string): void {
    const url = this.urls.get(key);
    if (url) {
      URL.revokeObjectURL(url);
      this.urls.delete(key);
    }
  }
  
  revokeAll(): void {
    for (const url of this.urls.values()) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
  }
  
  // Cleanup cuando se cierra la página
  cleanup(): void {
    window.addEventListener('beforeunload', () => {
      this.revokeAll();
    });
  }
}

export const blobManager = BlobUrlManager.getInstance();

// Auto-cleanup
blobManager.cleanup();