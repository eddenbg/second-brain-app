import { loadGIS, getStoredGoogleClientId } from './googleCalendarService';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_UPLOAD_TOKEN_KEY = 'google_drive_upload_token';
const DRIVE_UPLOAD_EXPIRY_KEY = 'google_drive_upload_expiry';
const DRIVE_TOKEN_KEY = 'google_drive_token';
const DRIVE_TOKEN_EXPIRY_KEY = 'google_drive_token_expiry';

export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime: string;
    webViewLink?: string;
    exportLinks?: Record<string, string>;
}

export const getStoredDriveToken = (): string | null => {
    const token = localStorage.getItem(DRIVE_TOKEN_KEY);
    const expiry = localStorage.getItem(DRIVE_TOKEN_EXPIRY_KEY);
    if (token && expiry && Date.now() < parseInt(expiry)) return token;
    localStorage.removeItem(DRIVE_TOKEN_KEY);
    localStorage.removeItem(DRIVE_TOKEN_EXPIRY_KEY);
    return null;
};

export const connectGoogleDrive = (): Promise<string> => {
    const clientId = getStoredGoogleClientId();
    if (!clientId) return Promise.reject(new Error('No Google Client ID configured'));
    return loadGIS().then(() => new Promise((resolve, reject) => {
        const client = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: DRIVE_SCOPE,
            callback: (response: any) => {
                if (response.error) { reject(new Error(response.error)); return; }
                const token = response.access_token;
                const expiry = Date.now() + (response.expires_in - 60) * 1000;
                localStorage.setItem(DRIVE_TOKEN_KEY, token);
                localStorage.setItem(DRIVE_TOKEN_EXPIRY_KEY, expiry.toString());
                resolve(token);
            }
        });
        client.requestAccessToken({ prompt: 'consent' });
    }));
};

export const disconnectGoogleDrive = () => {
    const token = getStoredDriveToken();
    if (token && window.google?.accounts?.oauth2) {
        window.google.accounts.oauth2.revoke(token);
    }
    localStorage.removeItem(DRIVE_TOKEN_KEY);
    localStorage.removeItem(DRIVE_TOKEN_EXPIRY_KEY);
};

export const listDriveFiles = async (token: string, query = ''): Promise<DriveFile[]> => {
    const mimeFilter = `(mimeType='application/pdf' or mimeType contains 'document' or mimeType contains 'presentation' or mimeType contains 'spreadsheet' or mimeType contains 'text/')`;
    const q = query.trim()
        ? `name contains '${query.replace(/'/g, "\\'")}' and ${mimeFilter} and trashed=false`
        : `${mimeFilter} and trashed=false`;

    const params = new URLSearchParams({
        q,
        fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,exportLinks)',
        orderBy: 'modifiedTime desc',
        pageSize: '50',
    });

    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
        if (response.status === 401) {
            localStorage.removeItem(DRIVE_TOKEN_KEY);
            localStorage.removeItem(DRIVE_TOKEN_EXPIRY_KEY);
        }
        throw new Error(`Drive API error: ${response.status}`);
    }

    const data = await response.json();
    return data.files || [];
};

export const getStoredDriveUploadToken = (): string | null => {
    const token = localStorage.getItem(DRIVE_UPLOAD_TOKEN_KEY);
    const expiry = localStorage.getItem(DRIVE_UPLOAD_EXPIRY_KEY);
    if (token && expiry && Date.now() < parseInt(expiry)) return token;
    localStorage.removeItem(DRIVE_UPLOAD_TOKEN_KEY);
    localStorage.removeItem(DRIVE_UPLOAD_EXPIRY_KEY);
    return null;
};

export const connectGoogleDriveUpload = (): Promise<string> => {
    const clientId = getStoredGoogleClientId();
    if (!clientId) return Promise.reject(new Error('No Google Client ID configured. Set it up in Settings first.'));
    return loadGIS().then(() => new Promise((resolve, reject) => {
        const client = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: DRIVE_FILE_SCOPE,
            callback: (response: any) => {
                if (response.error) { reject(new Error(response.error)); return; }
                const token = response.access_token;
                const expiry = Date.now() + (response.expires_in - 60) * 1000;
                localStorage.setItem(DRIVE_UPLOAD_TOKEN_KEY, token);
                localStorage.setItem(DRIVE_UPLOAD_EXPIRY_KEY, expiry.toString());
                resolve(token);
            }
        });
        client.requestAccessToken({ prompt: '' });
    }));
};

export const uploadFileToDrive = async (token: string, filename: string, blob: Blob): Promise<string> => {
    const metadata = JSON.stringify({ name: filename, mimeType: 'application/pdf' });
    const form = new FormData();
    form.append('metadata', new Blob([metadata], { type: 'application/json' }));
    form.append('file', blob, filename);

    const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
    );

    if (!response.ok) {
        if (response.status === 401) {
            localStorage.removeItem(DRIVE_UPLOAD_TOKEN_KEY);
            localStorage.removeItem(DRIVE_UPLOAD_EXPIRY_KEY);
        }
        throw new Error(`Drive upload failed (${response.status}). Please try again.`);
    }

    const data = await response.json();
    return data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`;
};
