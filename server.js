import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { harvest } from './harvester.js';

const PORT = 3001;
const TEMP_DIR_PREFIX = 'temp-clone-';

// Map of active remote repository URLs to local temporary folders
const activeTempRepos = new Map();

// Helper to run shell commands in promise wrapper
function runCmd(cmd, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, maxBuffer: 25 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ----------------------------------------------------
  // Endpoint: /api/harvest
  // ----------------------------------------------------
  if (req.url === '/api/harvest' && req.method === 'POST') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        let repoInput = payload.repoPath ? payload.repoPath.trim() : '';

        if (!repoInput) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Repository path or URL is required.' }));
          return;
        }

        console.log(`[Server] Received harvesting request for: ${repoInput}`);

        // Check if the input is a remote Git URL
        const isRemote = repoInput.startsWith('http://') || 
                         repoInput.startsWith('https://') || 
                         repoInput.startsWith('git@') ||
                         repoInput.startsWith('ssh://');

        if (isRemote) {
          // If this remote was already cloned recently, clean it up to prevent leaks
          if (activeTempRepos.has(repoInput)) {
            const oldPath = activeTempRepos.get(repoInput);
            console.log(`[Server] Pruning existing clone of the same repository: ${oldPath}`);
            try {
              if (fs.existsSync(oldPath)) {
                fs.rmSync(oldPath, { recursive: true, force: true });
              }
            } catch (pruneErr) {
              console.error(`[Server] Failed to prune directory: ${pruneErr.message}`);
            }
            activeTempRepos.delete(repoInput);
          }

          const tempFolderName = `${TEMP_DIR_PREFIX}${Date.now()}`;
          const tempPath = path.join(process.cwd(), tempFolderName);

          console.log(`[Server] Cloned repo target path: ${tempPath}`);
          
          try {
            // Perform FULL clone of remote repository (no --depth 5 constraint) to fetch all history!
            console.log(`[Server] Cloning remote repository: ${repoInput}...`);
            await runCmd(`git clone "${repoInput}" "${tempFolderName}"`);
            
            // Run the harvester on the temporary folder (parses commit graphs, metadata only)
            console.log(`[Server] Harvesting history...`);
            const commits = await harvest(tempPath);
            
            // Cache the clone path for dynamic on-demand file loading
            activeTempRepos.set(repoInput, tempPath);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ commits }));
          } catch (cloneErr) {
            console.error(`[Server] Error cloning/harvesting remote:`, cloneErr.message);
            
            // Ensure temp folder is cleaned up even if step failed
            if (fs.existsSync(tempPath)) {
              try { fs.rmSync(tempPath, { recursive: true, force: true }); } catch (e) {}
            }
            
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Failed to load remote repository: ${cloneErr.message}` }));
          }
        } else {
          // Local path harvesting
          let resolvedPath = path.isAbsolute(repoInput) ? repoInput : path.resolve(repoInput);

          console.log(`[Server] Harvesting local repository at: ${resolvedPath}`);
          try {
            const commits = await harvest(resolvedPath);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ commits }));
          } catch (harvestErr) {
            console.error(`[Server] Error harvesting local path:`, harvestErr.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: harvestErr.message }));
          }
        }
      } catch (err) {
        console.error(`[Server] Unexpected request processing error:`, err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'An unexpected internal error occurred.' }));
      }
    });
  } 
  // ----------------------------------------------------
  // Endpoint: /api/file-content
  // ----------------------------------------------------
  else if (req.url === '/api/file-content' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { repoPath, commitId, filePath } = JSON.parse(body);
        
        let targetPath = repoPath ? repoPath.trim() : '';
        if (!targetPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Repository path is required.' }));
          return;
        }

        // Resolve if cached under remote repo inputs
        if (activeTempRepos.has(targetPath)) {
          targetPath = activeTempRepos.get(targetPath);
        } else if (!path.isAbsolute(targetPath)) {
          targetPath = path.resolve(targetPath);
        }

        console.log(`[Server] Reading file on-demand: ${filePath} at ${commitId}`);

        exec(`git show ${commitId}:"${filePath}"`, { cwd: targetPath, maxBuffer: 15 * 1024 * 1024 }, (error, stdout) => {
          if (error) {
            // If file was deleted or does not exist at this commit point, return empty string
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ content: '' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ content: stdout }));
          }
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } 
  // ----------------------------------------------------
  // Endpoint: /api/cleanup
  // ----------------------------------------------------
  else if (req.url === '/api/cleanup' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { repoPath } = JSON.parse(body);
        if (repoPath && activeTempRepos.has(repoPath)) {
          const tempPath = activeTempRepos.get(repoPath);
          console.log(`[Server] Pruning clone directory on user request: ${tempPath}`);
          if (fs.existsSync(tempPath)) {
            try { fs.rmSync(tempPath, { recursive: true, force: true }); } catch (e) {}
          }
          activeTempRepos.delete(repoPath);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } 
  // ----------------------------------------------------
  // 404 handler
  // ----------------------------------------------------
  else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found.' }));
  }
});

server.listen(PORT, () => {
  console.log(`[Server] Git Harvester Service running at http://localhost:${PORT}`);
});
