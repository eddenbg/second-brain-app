const NOTION_TOKEN_KEY = 'notion_integration_token';
const PROXY = '/.netlify/functions/notionProxy';

export const getStoredNotionToken = (): string | null => localStorage.getItem(NOTION_TOKEN_KEY);
export const saveNotionToken = (token: string) => localStorage.setItem(NOTION_TOKEN_KEY, token.trim());
export const clearNotionToken = () => localStorage.removeItem(NOTION_TOKEN_KEY);

export interface NotionPage {
    id: string;
    title: string;
    url: string;
    lastEdited: string;
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

    const res = await fetch(`${PROXY}?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

    return (data.results || []).map((page: any) => ({
        id: page.id,
        title: extractTitle(page),
        url: page.url,
        lastEdited: page.last_edited_time,
    }));
};

const blockToText = (block: any): string => {
    const content = block[block.type];
    if (!content?.rich_text) return '';
    return content.rich_text.map((rt: any) => rt.plain_text).join('');
};

export const createScanPage = async (token: string, title: string, text: string, parentPageId: string): Promise<string> => {
    const res = await fetch(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'createPage', title, text, parentPageId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data.url;
};

export const fetchNotionPageContent = async (token: string, pageId: string): Promise<string> => {
    const params = new URLSearchParams({ token, action: 'blocks', pageId });
    const res = await fetch(`${PROXY}?${params}`);
    if (!res.ok) return '';
    const data = await res.json();
    return (data.results || []).map(blockToText).filter(Boolean).join('\n').slice(0, 8000);
};
