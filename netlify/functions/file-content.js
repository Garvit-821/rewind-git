import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

const TEMP_DIR = '/tmp';
const TEMP_DIR_PREFIX = 'rewind-clone-';

// Mirror the same in-memory cache used by harvest.js
// (Note: on Netlify each function invocation may be a fresh instance;
//  for same-session warm invocations it works perfectly)
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

    const content = await new Promise((resolve) => {
      exec(
        `git show ${commitId}:"${filePath}"`,
        { cwd: targetPath, maxBuffer: 15 * 1024 * 1024, timeout: 20000 },
        (error, stdout) => resolve(error ? '' : stdout)
      );
    });

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ content }) };
  } catch (err) {
    console.error('[file-content fn] Error:', err.message);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};
