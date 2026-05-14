import type { CalendarEvent, MoodleCourse, MoodleContent } from '../types';

/**
 * All Moodle requests are now routed through a Netlify function proxy
 * to bypass CORS restrictions on the college server.
 */

export const loginWithCredentials = async (username: string, password: string): Promise<string> => {
    const url = `/api/moodleProxy?action=login&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Login failed');
    if (!data.token) throw new Error('No token returned. Check your username/password.');
    return data.token;
};

export const testMoodleConnection = async (token: string): Promise<boolean> => {
    if (!token) return false;
    try {
        const url = `/api/moodleProxy?token=${encodeURIComponent(token)}&wsfunction=core_webservice_get_site_info`;
        const response = await fetch(url);
        if (!response.ok) return false;
        const data = await response.json();
        return !data.exception && !data.error;
    } catch (e) {
        return false;
    }
};

export const fetchMoodleEvents = async (token: string): Promise<CalendarEvent[]> => {
    if (!token) return [];
    try {
        const url = `/api/moodleProxy?token=${encodeURIComponent(token)}&wsfunction=core_calendar_get_calendar_events`;
        console.log(`[MoodleService] Fetching events...`);
        const response = await fetch(url);
        
        if (!response.ok) {
            const text = await response.text();
            console.error(`[MoodleService] Events fetch failed with status ${response.status}: ${text}`);
            let errorData;
            try {
                errorData = JSON.parse(text);
            } catch (e) {
                errorData = { error: text || "Network response was not ok" };
            }
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log(`[MoodleService] Events fetched successfully`);
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        if (data.events) {
            return data.events.map((e: any) => ({
                id: `moodle_${e.id}`,
                title: e.name,
                startTime: new Date(e.timestart * 1000).toISOString(),
                endTime: new Date((e.timestart + e.timeduration) * 1000).toISOString(),
                category: 'college',
                description: e.description,
                source: 'moodle',
            }));
        }
    } catch (e) {
        console.error("Moodle Event Fetch Error", e);
    }
    return [];
};

export const fetchMoodleCourses = async (token: string): Promise<MoodleCourse[]> => {
    if (!token) return [];
    try {
        // Switched to a more reliable Moodle function to fetch courses for the current user.
        const url = `/api/moodleProxy?token=${encodeURIComponent(token)}&wsfunction=core_course_get_enrolled_courses_by_timeline_classification&classification=inprogress`;
        console.log(`[MoodleService] Fetching courses...`);
        const response = await fetch(url);
        
        if (!response.ok) {
            const text = await response.text();
            console.error(`[MoodleService] Courses fetch failed with status ${response.status}: ${text}`);
            let errorData;
            try {
                errorData = JSON.parse(text);
            } catch (e) {
                errorData = { error: text || "Network response was not ok" };
            }
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log(`[MoodleService] Courses fetched successfully`);
        
        if (data.error) throw new Error(data.error);
        if (data.exception) throw new Error(data.message);
        
        // This function returns an object with a 'courses' array
        return data.courses || [];
    } catch (e) {
        console.error("Moodle Course Fetch Error", e);
        throw e;
    }
};

export const fetchCourseContents = async (token: string, courseId: number): Promise<MoodleContent[]> => {
    if (!token) return [];
    try {
        const url = `/api/moodleProxy?token=${encodeURIComponent(token)}&wsfunction=core_course_get_contents&courseid=${courseId}`;
        console.log(`[MoodleService] Fetching contents for course ${courseId}...`);
        const response = await fetch(url);
        
        if (!response.ok) {
            const text = await response.text();
            console.error(`[MoodleService] Contents fetch failed with status ${response.status}: ${text}`);
            let errorData;
            try {
                errorData = JSON.parse(text);
            } catch (e) {
                errorData = { error: text || "Network response was not ok" };
            }
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const sections = await response.json();
        console.log(`[MoodleService] Contents fetched successfully for course ${courseId}`);
        
        if (sections.error) throw new Error(sections.error);
        if (sections.exception) throw new Error(sections.message);

        const contents: MoodleContent[] = [];
        sections.forEach((section: any) => {
            section.modules.forEach((mod: any) => {
                if (mod.modname === 'resource' || mod.modname === 'file' || mod.modname === 'url') {
                    // Append token to file URL to allow direct access without login redirection
                    let fileurl = mod.contents?.[0]?.fileurl;
                    if (fileurl && !fileurl.includes('token=')) {
                        fileurl += (fileurl.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
                    }

                    contents.push({
                        id: mod.id,
                        name: mod.name,
                        type: mod.modname === 'url' ? 'url' : 'file',
                        fileurl: fileurl,
                        mimetype: mod.contents?.[0]?.mimetype
                    });
                }
            });
        });
        return contents;
    } catch (e) {
        console.error("Moodle Content Fetch Error", e);
        throw e;
    }
};
