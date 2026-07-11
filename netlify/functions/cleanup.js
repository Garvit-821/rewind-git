import fs from 'fs';
import path from 'path';

const TEMP_DIR = '/tmp';
const TEMP_DIR_PREFIX = 'rewind-clone-';

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { repoPath } = JSON.parse(event.body || '{}');

    // Try to clean up any matching temp clone in /tmp
    if (repoPath) {
      try {
        const tmpEntries = fs.readdirSync(TEMP_DIR);
        for (const entry of tmpEntries) {
          if (entry.startsWith(TEMP_DIR_PREFIX)) {
            const fullPath = path.join(TEMP_DIR, entry);
            try { fs.rmSync(fullPath, { recursive: true, force: true }); } catch (_) {}
          }
        }
      } catch (_) {}
    }

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};
