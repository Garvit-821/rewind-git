import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const TEMP_DIR = '/tmp';
const TEMP_DIR_PREFIX = 'rewind-clone-';

// In-memory cache mapping remote URL -> local /tmp path (per function instance)
const activeTempRepos = new Map();

function runCmd(cmd, cwd = TEMP_DIR) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, maxBuffer: 25 * 1024 * 1024, timeout: 55000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

/**
 * Parse raw `git log --pretty=format:"%H|%P|%an|%at|%s" --raw` output
 * into structured commit objects. Mirrors harvester.js logic but runs
 * entirely inside the serverless function (no child import needed).
 */
function parseGitLog(stdout) {
  const lines = stdout.split(/\r?\n/);
  const commits = [];
  let currentCommit = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith(':')) {
      if (currentCommit) {
        const tabIndex = trimmed.indexOf('\t');
        if (tabIndex !== -1) {
          const metaPart = trimmed.slice(0, tabIndex).trim();
          const pathPart = trimmed.slice(tabIndex + 1);
          const metaTokens = metaPart.split(/\s+/);
          if (metaTokens.length >= 5) {
            const statusToken = metaTokens[4];
            currentCommit.details.push({ status: statusToken, path: pathPart });
            if (statusToken.startsWith('A')) currentCommit.additions++;
            else if (statusToken.startsWith('D')) currentCommit.deletions++;
            else currentCommit.modifications++;
          }
        }
      }
    } else if (trimmed.includes('|')) {
      const parts = trimmed.split('|');
      const id = parts[0];
      const parentField = parts[1] || '';
      const author = parts[2] || 'Unknown';
      const timestampVal = parseInt(parts[3], 10) || Math.floor(Date.now() / 1000);
      const message = parts.slice(4).join('|');
      const parentIds = parentField ? parentField.split(' ').filter(Boolean) : [];

      if (currentCommit) {
        currentCommit.filesChanged = currentCommit.additions + currentCommit.deletions;
        commits.push(currentCommit);
      }
      currentCommit = { id, parentIds, author, timestamp: timestampVal, message,
        filesChanged: 0, additions: 0, deletions: 0, modifications: 0, details: [] };
    }
  }

  if (currentCommit) {
    currentCommit.filesChanged = currentCommit.additions + currentCommit.deletions;
    commits.push(currentCommit);
  }
  return commits;
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
    const repoInput = (repoPath || '').trim();

    if (!repoInput) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Repository path or URL is required.' }) };
    }

    const isRemote = /^(https?:\/\/|git@|ssh:\/\/)/.test(repoInput);
    let targetPath;

    if (isRemote) {
      // Clean up any previous clone of same URL
      if (activeTempRepos.has(repoInput)) {
        const old = activeTempRepos.get(repoInput);
        try { if (fs.existsSync(old)) fs.rmSync(old, { recursive: true, force: true }); } catch (_) {}
        activeTempRepos.delete(repoInput);
      }

      const folderName = `${TEMP_DIR_PREFIX}${Date.now()}`;
      targetPath = path.join(TEMP_DIR, folderName);

      console.log(`[harvest fn] Cloning ${repoInput} -> ${targetPath}`);
      await runCmd(`git clone --depth 500 "${repoInput}" "${targetPath}"`);
      activeTempRepos.set(repoInput, targetPath);
    } else {
      // Local path — only valid when self-hosting / Netlify dev
      targetPath = path.isAbsolute(repoInput) ? repoInput : path.resolve(repoInput);
      if (!fs.existsSync(targetPath)) {
        return { statusCode: 400, headers: corsHeaders(),
          body: JSON.stringify({ error: `Path does not exist: ${targetPath}. When deployed on Netlify, only remote Git URLs are supported.` }) };
      }
    }

    const logOutput = await runCmd(
      'git log --pretty=format:"%H|%P|%an|%at|%s" --raw',
      targetPath
    );

    const commits = parseGitLog(logOutput);
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ commits })
    };
  } catch (err) {
    console.error('[harvest fn] Error:', err.message);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
