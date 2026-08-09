import { Filesystem, Directory } from '@capacitor/filesystem';
import { Device } from '@capacitor/device';
import { extractHandwritingFromImage } from './geminiService';

export interface CallRecording {
  id: string;
  fileName: string;
  filePath: string;
  dateRecorded: string;
  duration?: number;
  phoneNumber?: string;
  isImported: boolean;
}

// Store locally on device to track imported files
const IMPORTED_CALLS_KEY = 'imported_call_recordings';

// Location where call recordings are typically stored on Android
const CALL_RECORDING_PATHS = [
  '/storage/emulated/0/Recordings',
  '/storage/emulated/0/DCIM/Recorder',
  '/storage/emulated/0/Downloads/Calls',
  '/storage/emulated/0/CallRecorder'
];

class CallRecordingService {
  private scanningInterval: NodeJS.Timeout | null = null;

  /**
   * Start monitoring for new call recordings
   * Automatically imports recordings into the app
   */
  async startMonitoring(): Promise<void> {
    const info = await Device.getInfo();

    // Only run on actual Android devices, not web
    if (info.platform !== 'android') {
      console.log('Call recording monitoring only available on Android');
      return;
    }

    // Scan for recordings every 30 seconds
    this.scanningInterval = setInterval(async () => {
      try {
        await this.scanAndImportRecordings();
      } catch (error) {
        console.error('Error scanning call recordings:', error);
      }
    }, 30000);

    // Do initial scan
    await this.scanAndImportRecordings();
  }

  /**
   * Stop monitoring for call recordings
   */
  stopMonitoring(): void {
    if (this.scanningInterval) {
      clearInterval(this.scanningInterval);
      this.scanningInterval = null;
    }
  }

  /**
   * Scan for new call recordings and import them
   */
  private async scanAndImportRecordings(): Promise<CallRecording[]> {
    const imported: CallRecording[] = [];
    const importedIds = await this.getImportedCallIds();

    for (const path of CALL_RECORDING_PATHS) {
      try {
        const result = await Filesystem.readdir({
          path,
          directory: Directory.External
        });

        for (const file of result.files) {
          // Only process audio files
          if (!this.isAudioFile(file.name)) continue;

          const callId = `${file.name}_${file.ctime || 0}`;

          // Skip already imported files
          if (importedIds.has(callId)) continue;

          const callRecord: CallRecording = {
            id: callId,
            fileName: file.name,
            filePath: `${path}/${file.name}`,
            dateRecorded: new Date(file.ctime || 0).toISOString(),
            isImported: false
          };

          // Mark as imported
          await this.markCallAsImported(callId);
          imported.push(callRecord);

          // Dispatch event that a new call was found
          this.dispatchCallFoundEvent(callRecord);
        }
      } catch (error) {
        // Path may not exist or permission denied - continue checking other paths
        continue;
      }
    }

    return imported;
  }

  /**
   * Check if file is an audio file
   */
  private isAudioFile(fileName: string): boolean {
    const audioExtensions = ['.m4a', '.mp3', '.wav', '.aac', '.ogg', '.flac'];
    const ext = fileName.toLowerCase().slice(-4);
    return audioExtensions.some(audioExt => fileName.toLowerCase().endsWith(audioExt));
  }

  /**
   * Get set of already imported call IDs
   */
  private async getImportedCallIds(): Promise<Set<string>> {
    try {
      const result = await Filesystem.readFile({
        path: IMPORTED_CALLS_KEY,
        directory: Directory.Data,
        encoding: 'utf8'
      });
      const ids = JSON.parse(result.data as string);
      return new Set(ids);
    } catch {
      return new Set();
    }
  }

  /**
   * Mark a call recording as imported
   */
  private async markCallAsImported(callId: string): Promise<void> {
    const imported = await this.getImportedCallIds();
    imported.add(callId);

    await Filesystem.writeFile({
      path: IMPORTED_CALLS_KEY,
      directory: Directory.Data,
      data: JSON.stringify(Array.from(imported)),
      encoding: 'utf8'
    });
  }

  /**
   * Dispatch event when new call is found
   */
  private dispatchCallFoundEvent(callRecord: CallRecording): void {
    const event = new CustomEvent('callRecordingFound', {
      detail: callRecord
    });
    window.dispatchEvent(event);
  }

  /**
   * Read call recording file as data URL
   */
  async readCallRecordingAsDataUrl(filePath: string): Promise<string> {
    try {
      const result = await Filesystem.readFile({
        path: filePath,
        directory: Directory.External
      });
      return `data:audio/m4a;base64,${result.data}`;
    } catch (error) {
      console.error('Error reading call recording:', error);
      throw error;
    }
  }

  /**
   * Request permission to access call logs (Android 10+)
   */
  async requestCallLogPermission(): Promise<boolean> {
    try {
      // This would require a custom Capacitor plugin for READ_CALL_LOG permission
      // For now, we rely on the file system approach above
      return true;
    } catch {
      return false;
    }
  }
}

export const callRecordingService = new CallRecordingService();
