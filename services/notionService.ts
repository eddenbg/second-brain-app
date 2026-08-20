import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { retryWithExponentialBackoff } from '../utils/retryWithExponentialBackoff';

const NOTION_TOKEN_KEY = 'notion_integration_token';
const NOTION_CLIENT_ID_KEY = 'notion_client_id';
const NOTION_CLIENT_SECRET_KEY = 'notion_client_secret';
const PROXY = '/.netlify/functions/notionProxy';

export const getStoredNotionToken = (): string | null => localStorage.getItem(NOTION_TOKEN_KEY);
export const saveNotionToken = (token: string) => localStorage.setItem(NOTION_TOKEN_KEY, token.trim());
export const clearNotionToken = () => localStorage.removeItem(NOTION_TOKEN_KEY);

export const getStoredNotionClientId = (): string => localStorage.getItem(NOTION_CLIENT_ID_KEY) || '';
export const saveNotionClientId = (id: string) => localStorage.setItem(NOTION_CLIENT_ID_KEY, id.trim());
export const getStoredNotionClientSecret = (): string => localStorage.getItem(NOTION_CLIENT_SECRET_KEY) || '';
export const saveNotionClientSecret = (secret: string) => localStorage.setItem(NOTION_CLIENT_SECRET_KEY, secret.trim());
export const clearNotionCredentials = () => {
    localStorage.removeItem(NOTION_CLIENT_ID_KEY);
    localStorage.removeItem(NOTION_CLIENT_SECRET_KEY);
};

// Notion compares redirect_uri against the registered one character for
// character, and the token exchange in App.tsx sends the same string again, so
// both sides must build it the same way: origin plus a single trailing slash.
export const getNotionRedirectUri = (): string => `${window.location.origin}/`;

export const buildNotionAuthUrl = (clientId: string): string => {
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        owner: 'user',
        redirect_uri: getNotionRedirectUri(),
        state: 'notion_oauth',
    });
    return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
};

export interface NotionPage {
    id: string;
    title: string;
    url: string;
    lastEdited: string;
    parentId?: string; // undefined = workspace root
}

const extractTitle = (page: any): string => {
    for (const key of Object.keys(page.properties || {})) {
        const prop = page.properties[key];
        if (prop.type === 'title' && prop.title?.length > 0) {
            return prop.title.map((t: any) => t.plain_text).join('');
        }
    }
    return 'Untitled';
};

export const searchNotionPages = async (token: string, query = ''): Promise<NotionPage[]> => {
    const params = new URLSearchParams({ token, action: 'search' });
    if (query) params.set('query', query);

    const res = await retryWithExponentialBackoff(() =>
        fetchWithTimeout(`${PROXY}?${params}`, { timeout: 30000 }),
        { maxRetries: 2, initialDelayMs: 1000 }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

    return (data.results || []).map((page: any) => ({
        id: page.id,
        title: extractTitle(page),
        url: page.url,
        lastEdited: page.last_edited_time,
        parentId: page.parent?.type === 'page_id' ? page.parent.page_id : undefined,
    }));
};

const blockToText = (block: any): string => {
    const content = block[block.type];
    if (!content?.rich_text) return '';
    return content.rich_text.map((rt: any) => rt.plain_text).join('');
};

export const createScanPage = async (token: string, title: string, text: string, parentPageId: string): Promise<string> => {
    const res = await retryWithExponentialBackoff(() =>
        fetchWithTimeout(PROXY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, action: 'createPage', title, text, parentPageId }),
            timeout: 30000,
        }),
        { maxRetries: 2, initialDelayMs: 1000 }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data.url;
};

export const fetchNotionPageContent = async (token: string, pageId: string): Promise<string> => {
    const params = new URLSearchParams({ token, action: 'blocks', pageId });
    const res = await retryWithExponentialBackoff(() =>
        fetchWithTimeout(`${PROXY}?${params}`, { timeout: 30000 }),
        { maxRetries: 2, initialDelayMs: 1000 }
    );
    if (!res.ok) return '';
    const data = await res.json();
    return (data.results || []).map(blockToText).filter(Boolean).join('\n').slice(0, 8000);
};

export interface NotionLink {
    url: string;
    label: string;
}

const MAX_LINK_PAGES = 5; // 5 * 100 blocks — a generous cap against runaway pagination

/** All blocks on a page, following Notion's cursor past the first 100. */
const fetchAllBlocks = async (token: string, pageId: string): Promise<any[]> => {
    const blocks: any[] = [];
    let cursor: string | undefined;

    for (let i = 0; i < MAX_LINK_PAGES; i++) {
        const params = new URLSearchParams({ token, action: 'blocks', pageId });
        if (cursor) params.set('cursor', cursor);
        const res = await retryWithExponentialBackoff(() =>
            fetchWithTimeout(`${PROXY}?${params}`, { timeout: 30000 }),
            { maxRetries: 2, initialDelayMs: 1000 }
        );
        if (!res.ok) break;
        const data = await res.json();
        blocks.push(...(data.results || []));
        if (!data.has_more || !data.next_cursor) break;
        cursor = data.next_cursor;
    }

    return blocks;
};

/**
 * Every external URL findable in one block: a hyperlink on a run of text
 * (rich_text[].href), or a bookmark/embed/link_preview block, which Notion uses
 * specifically for a pasted link with no surrounding text.
 */
const extractLinksFromBlock = (block: any): NotionLink[] => {
    const links: NotionLink[] = [];
    const content = block[block.type];

    for (const rt of content?.rich_text || []) {
        if (rt.href) links.push({ url: rt.href, label: rt.plain_text || rt.href });
    }

    if (block.type === 'bookmark' || block.type === 'embed' || block.type === 'link_preview') {
        const url: string | undefined = content?.url;
        if (url) {
            const caption = (content?.caption || []).map((c: any) => c.plain_text).join('').trim();
            links.push({ url, label: caption || url });
        }
    }

    return links;
};

/** Every distinct external link on a Notion page, in document order. */
export const fetchNotionPageLinks = async (token: string, pageId: string): Promise<NotionLink[]> => {
    const blocks = await fetchAllBlocks(token, pageId);
    const seen = new Set<string>();
    const links: NotionLink[] = [];

    for (const block of blocks) {
        for (const link of extractLinksFromBlock(block)) {
            if (seen.has(link.url)) continue;
            seen.add(link.url);
            links.push(link);
        }
    }

    return links;
};
