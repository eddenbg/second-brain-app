/**
 * Capacitor Live Updates Service
 * Checks for and loads new web app versions from Netlify
 * Provides instant updates without requiring APK rebuilds
 */

interface VersionInfo {
  version: string;
  buildTime: number;
}

class UpdateService {
  private readonly DEPLOYED_URL = 'https://eddenbg-second-brain.netlify.app';
  private readonly VERSION_FILE = 'version.json';
  private readonly LOCAL_VERSION_KEY = 'app_version_info';
  private checkInterval: NodeJS.Timeout | null = null;
  private listeners: Array<(hasUpdate: boolean) => void> = [];

  /**
   * Start checking for updates periodically
   * @param intervalMs Check interval in milliseconds (default: 5 minutes)
   */
  startMonitoring(intervalMs: number = 5 * 60 * 1000): void {
    // Check immediately on start
    this.checkForUpdates();

    // Then check periodically
    this.checkInterval = setInterval(() => {
      this.checkForUpdates();
    }, intervalMs);
  }

  /**
   * Stop monitoring for updates
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Manually check for updates
   */
  async checkForUpdates(): Promise<boolean> {
    try {
      // Try to fetch version info from deployed app
      const response = await fetch(`${this.DEPLOYED_URL}/${this.VERSION_FILE}`, {
        method: 'GET',
        cache: 'no-cache', // Force fresh fetch
      });

      if (!response.ok) {
        // If version.json doesn't exist, check index.html modification time
        return await this.checkByIndexHtml();
      }

      const remoteVersion: VersionInfo = await response.json();
      const localVersion = this.getLocalVersion();

      // If remote version is newer, notify listeners
      if (remoteVersion.buildTime > (localVersion?.buildTime || 0)) {
        console.log('[UpdateService] New version available:', remoteVersion);
        this.saveLocalVersion(remoteVersion);
        this.notifyListeners(true);

        // Auto-reload the app to get new content
        this.reloadApp();
        return true;
      }

      return false;
    } catch (error) {
      console.warn('[UpdateService] Error checking for updates:', error);
      return false;
    }
  }

  /**
   * Fallback: Check if index.html has been updated
   */
  private async checkByIndexHtml(): Promise<boolean> {
    try {
      const response = await fetch(`${this.DEPLOYED_URL}/index.html`, {
        method: 'HEAD',
        cache: 'no-cache',
      });

      if (response.ok) {
        const lastModified = response.headers.get('last-modified');
        if (lastModified) {
          const remoteTime = new Date(lastModified).getTime();
          const localVersion = this.getLocalVersion();

          if (remoteTime > (localVersion?.buildTime || 0)) {
            console.log('[UpdateService] App updated, reloading...');
            this.reloadApp();
            return true;
          }
        }
      }
    } catch (error) {
      console.warn('[UpdateService] Error checking index.html:', error);
    }

    return false;
  }

  /**
   * Clear service worker cache and reload app
   */
  private async reloadApp(): Promise<void> {
    try {
      // Clear service worker cache if available
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }

      // Reload the page to get fresh content
      window.location.reload();
    } catch (error) {
      console.warn('[UpdateService] Error reloading app:', error);
      // Fallback: hard reload
      window.location.href = window.location.origin + window.location.pathname;
    }
  }

  /**
   * Get locally stored version info
   */
  private getLocalVersion(): VersionInfo | null {
    try {
      const stored = localStorage.getItem(this.LOCAL_VERSION_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Save version info locally
   */
  private saveLocalVersion(version: VersionInfo): void {
    try {
      localStorage.setItem(this.LOCAL_VERSION_KEY, JSON.stringify(version));
    } catch (error) {
      console.warn('[UpdateService] Error saving version:', error);
    }
  }

  /**
   * Subscribe to update notifications
   */
  onUpdate(callback: (hasUpdate: boolean) => void): () => void {
    this.listeners.push(callback);
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  /**
   * Notify all listeners of update status
   */
  private notifyListeners(hasUpdate: boolean): void {
    this.listeners.forEach(listener => {
      try {
        listener(hasUpdate);
      } catch (error) {
        console.warn('[UpdateService] Error calling listener:', error);
      }
    });
  }
}

// Export singleton instance
export const updateService = new UpdateService();

// Auto-start monitoring when app initializes
if (typeof window !== 'undefined') {
  updateService.startMonitoring();
}
