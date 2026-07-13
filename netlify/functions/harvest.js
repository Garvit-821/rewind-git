import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node/index.js';
import fs from 'fs';
import path from 'path';

const TEMP_DIR = '/tmp';
const TEMP_DIR_PREFIX = 'rewind-clone-';

// In-memory cache mapping remote URL -> local /tmp path (per function instance)
const activeTempRepos = new Map();

async function getCommitDiff(dir, commitOid, parentOid) {
  const trees = [];
  if (parentOid) {
    trees.push(git.TREE({ ref: parentOid }));
  } else {
    trees.push(null);
  }
  trees.push(git.TREE({ ref: commitOid }));

  try {
    const walkResult = await git.walk({
      fs,
      dir,
      trees,
      filter: async function (filepath, [A, B]) {
        if (A && B) {
          const oida = await A.oid();
          const oidb = await B.oid();
          if (oida === oidb) {
            return false; // Skip identical directories/files (do not descend)
          }
        }
        return true;
      },
      map: async function (filepath, [A, B]) {
        if (filepath === '.') return;

        const typeA = A ? await A.type() : null;
        const typeB = B ? await B.type() : null;

        if (typeA === 'tree' || typeB === 'tree') {
          return; // Skip directories from file diff
        }

        const oida = A ? await A.oid() : null;
        const oidb = B ? await B.oid() : null;

        let status = 'M';
        if (!oida && oidb) status = 'A';
        else if (oida && !oidb) status = 'D';

        return { status, path: filepath };
      }
    });

    return walkResult.filter(Boolean);
  } catch (err) {
    console.error(`[harvest fn] Error diffing ${commitOid} with ${parentOid}:`, err.message);
    return [];
  }
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
      await git.clone({
        fs,
        http,
        dir: targetPath,
        url: repoInput,
        singleBranch: true,
        depth: 250 // Fetch enough commits for history but limit size
      });
      activeTempRepos.set(repoInput, targetPath);
    } else {
      // Local path — only valid when self-hosting / Netlify dev
      targetPath = path.isAbsolute(repoInput) ? repoInput : path.resolve(repoInput);
      if (!fs.existsSync(targetPath)) {
        return { statusCode: 400, headers: corsHeaders(),
          body: JSON.stringify({ error: `Path does not exist: ${targetPath}. When deployed on Netlify, only remote Git URLs are supported.` }) };
      }
    }

    console.log(`[harvest fn] Reading logs from ${targetPath}`);
    const rawCommits = await git.log({
      fs,
      dir: targetPath,
      depth: 250
    });

    const commits = [];
    for (const c of rawCommits) {
      const parentIds = c.commit.parent || [];
      const primaryParent = parentIds[0] || null;
      const details = await getCommitDiff(targetPath, c.oid, primaryParent);

      let additions = 0;
      let deletions = 0;
      let modifications = 0;

      details.forEach(item => {
        if (item.status === 'A') additions++;
        else if (item.status === 'D') deletions++;
        else modifications++;
      });

      commits.push({
        id: c.oid,
        parentIds,
        author: c.commit.author.name || 'Unknown',
        timestamp: c.commit.author.timestamp,
        message: c.commit.message.trim(),
        filesChanged: additions + deletions,
        additions,
        deletions,
        modifications,
        details
      });
    }

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
