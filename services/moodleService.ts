import type { CalendarEvent, MoodleCourse, MoodleContent } from '../types';

/**
 * All Moodle requests are now routed through a Netlify function proxy
 * to bypass CORS restrictions on the college server.
 */

export const fetchMoodleEvents = async (token: string): Promise<CalendarEvent[]> => {
    if (!token) return [];
    try {
        const url = `/.netlify/functions/moodleProxy?token=${token}&wsfunction=core_calendar_get_calendar_events`;
        const response = await fetch(url);
        const data = await response.json();
        
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
        const url = `/.netlify/functions/moodleProxy?token=${token}&wsfunction=core_enrol_get_users_courses`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.exception) throw new Error(data.message);
        return data;
    } catch (e) {
        console.error("Moodle Course Fetch Error", e);
        throw e;
    }
};

export const fetchCourseContents = async (token: string, courseId: number): Promise<MoodleContent[]> => {
    if (!token) return [];
    try {
        const url = `/.netlify/functions/moodleProxy?token=${token}&wsfunction=core_course_get_contents&courseid=${courseId}`;
        const response = await fetch(url);
        const sections = await response.json();
        
        if (sections.exception) throw new Error(sections.message);

        const contents: MoodleContent[] = [];
        sections.forEach((section: any) => {
            section.modules.forEach((mod: any) => {
                if (mod.modname === 'resource' || mod.modname === 'file' || mod.modname === 'url') {
                    // Append token to file URL to allow direct access without login redirection
                    let fileurl = mod.contents?.[0]?.fileurl;
                    if (fileurl && !fileurl.includes('token=')) {
                        fileurl += (fileurl.includes('?') ? '&' : '?') + `token=${token}`;
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