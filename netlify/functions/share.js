// Helper function to escape HTML to prevent XSS
const escapeHtml = (text) => {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, char => map[char]);
};

export default async (req, context) => {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB limit

  try {
    let formData;
    try {
      formData = await req.formData();
    } catch (e) {
      console.error('FormData parsing error:', e.message);
      return new Response(
        `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Error</title>
    <style>
        body {
            margin: 0;
            padding: 20px;
            background: #001F3F;
            font-family: system-ui, -apple-system, sans-serif;
            color: #ff6b6b;
        }
    </style>
</head>
<body>
    <h2>Error Processing File</h2>
    <p>Could not parse the shared file. Please try again or check that you're sharing an audio file.</p>
    <p><a href="/" style="color: white;">Return to app</a></p>
</body>
</html>`,
        { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }

    // Handle text/URL shares (fallback to web clips)
    const text = formData.get('text');
    const url = formData.get('url');
    const title = formData.get('title');

    if (url || text) {
      // Redirect to personal hub web clips with shared data
      const params = new URLSearchParams({
        shared: 'true',
        type: 'web',
        ...(url && { url }),
        ...(title && { title }),
        ...(text && { text })
      });
      return new Response(null, {
        status: 302,
        headers: { Location: `/?${params.toString()}` }
      });
    }

    // Handle audio file share - try multiple possible field names
    let audioFile = formData.get('audio');
    if (!audioFile) audioFile = formData.get('files'); // Try alternate field name

    if (!audioFile) {
      return new Response(
        `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Error</title>
    <style>
        body {
            margin: 0;
            padding: 20px;
            background: #001F3F;
            font-family: system-ui, -apple-system, sans-serif;
            color: #ff6b6b;
        }
    </style>
</head>
<body>
    <h2>No file provided</h2>
    <p>Please share an audio file (M4A, MP3, MP4, WAV, or WebM).</p>
    <p><a href="/" style="color: white;">Return to app</a></p>
</body>
</html>`,
        { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }

    // Validate file type
    const validTypes = ['audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/wav', 'audio/webm'];
    if (!validTypes.some(type => audioFile.type.includes(type.split('/')[1]))) {
      return new Response(
        JSON.stringify({ error: 'Invalid file type. Please share an M4A, MP3, MP4, WAV, or WebM audio file.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate file size
    if (audioFile.size > MAX_FILE_SIZE) {
      const sizeMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
      return new Response(
        JSON.stringify({ error: `File is too large. Maximum size is ${sizeMB}MB.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Read file as buffer
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const base64Data = buffer.toString('base64');
    const fileName = escapeHtml(audioFile.name || `lecture-${Date.now()}.m4a`);
    const mimeType = escapeHtml(audioFile.type || 'audio/m4a');

    // Check sessionStorage size before storing
    const estimatedSize = base64Data.length + JSON.stringify({fileName, mimeType}).length;
    const maxSessionStorage = 5 * 1024 * 1024; // 5MB sessionStorage limit
    if (estimatedSize > maxSessionStorage * 0.8) {
      return new Response(
        JSON.stringify({
          error: `File is too large for browser storage (${(estimatedSize / (1024*1024)).toFixed(1)}MB). Maximum is about 4MB. Please use a smaller file.`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create an HTML page that stores file in sessionStorage and redirects to app
    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Processing shared audio...</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: #001F3F;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            font-family: system-ui, -apple-system, sans-serif;
            color: white;
        }
        .container {
            text-align: center;
        }
        .spinner {
            border: 4px solid rgba(255,255,255,0.3);
            border-top: 4px solid white;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        p { margin: 0; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <p>Processing your lecture audio...</p>
    </div>
    <script>
        try {
            // Check sessionStorage availability and space
            const testKey = '__sessionStorage_test__';
            try {
                sessionStorage.setItem(testKey, '1');
                sessionStorage.removeItem(testKey);
            } catch (e) {
                throw new Error('sessionStorage is not available or full');
            }

            // Store file data in sessionStorage
            sessionStorage.setItem('sharedAudioData', JSON.stringify({
                fileName: '${fileName}',
                mimeType: '${mimeType}',
                base64Data: '${base64Data}',
                timestamp: Date.now()
            }));

            // Redirect to college hub to start transcription
            window.location.replace('/college?shared=true&type=audio');
        } catch (error) {
            console.error('Error storing shared file:', error);
            const errorMsg = error?.message || 'Unknown error occurred';
            document.body.innerHTML = '<p>Error: ' + (errorMsg.length > 100 ? errorMsg.substring(0, 100) + '...' : errorMsg).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])) + '</p>';
        }
    </script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch (error) {
    console.error('Share handler error:', error);
    const errorMsg = escapeHtml(error?.message || 'Failed to process shared file');
    return new Response(
      `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Error</title>
    <style>
        body {
            margin: 0;
            padding: 20px;
            background: #001F3F;
            font-family: system-ui, -apple-system, sans-serif;
            color: #ff6b6b;
        }
    </style>
</head>
<body>
    <h2>Error Processing File</h2>
    <p>${errorMsg}</p>
    <p><a href="/" style="color: white;">Return to app</a></p>
</body>
</html>`,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
};
