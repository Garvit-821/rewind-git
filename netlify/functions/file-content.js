import git from 'isomorphic-git';
import fs from 'fs';
import path from 'path';

const TEMP_DIR = '/tmp';
const TEMP_DIR_PREFIX = 'rewind-clone-';

// Mirror the same in-memory cache used by harvest.js
const activeTempRepos = new Map();

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
    const { repoPath, commitId, filePath } = JSON.parse(event.body || '{}');
    let targetPath = (repoPath || '').trim();

    if (!targetPath) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Repository path is required.' }) };
    }

    // Resolve cached temp clone path if it was a remote URL
    if (activeTempRepos.has(targetPath)) {
      targetPath = activeTempRepos.get(targetPath);
    } else {
      // Try to find a matching rewind-clone-* folder in /tmp
      try {
        const tmpEntries = fs.readdirSync(TEMP_DIR);
        const match = tmpEntries
          .filter(e => e.startsWith(TEMP_DIR_PREFIX))
          .map(e => path.join(TEMP_DIR, e))
          .find(p => fs.existsSync(p));
        if (match) targetPath = match;
        else if (!path.isAbsolute(targetPath)) targetPath = path.resolve(targetPath);
      } catch (_) {
        if (!path.isAbsolute(targetPath)) targetPath = path.resolve(targetPath);
      }
    }

    // Read the file contents using isomorphic-git's readBlob
    const content = await (async () => {
      try {
        const { blob } = await git.readBlob({
          fs,
          dir: targetPath,
          oid: commitId,
          filepath: filePath
        });
        return new TextDecoder().decode(blob);
      } catch (err) {
        console.error(`[file-content fn] Failed to read ${filePath} at ${commitId}:`, err.message);
        return '';
      }
    })();

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ content }) };
  } catch (err) {
    console.error('[file-content fn] Error:', err.message);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};
