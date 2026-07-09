import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { harvest } from './harvester.js';

const PORT = 3001;
const TEMP_DIR_PREFIX = 'temp-clone-';

// Helper to run shell commands in promise wrapper
function runCmd(cmd, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
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
          const tempFolderName = `${TEMP_DIR_PREFIX}${Date.now()}`;
          const tempPath = path.join(process.cwd(), tempFolderName);

          console.log(`[Server] Cloned repo target: ${tempPath}`);
          
          try {
            // Shallow clone target repository (depth 5 to load history quickly)
            console.log(`[Server] Cloning remote repository: ${repoInput}...`);
            await runCmd(`git clone --depth 5 "${repoInput}" "${tempFolderName}"`);
            
            // Run the harvester on the temporary folder
            console.log(`[Server] Harvesting history...`);
            const commits = await harvest(tempPath);
            
            // Clean up temporary clone folder
            console.log(`[Server] Cleaning up clone directory: ${tempPath}`);
            fs.rmSync(tempPath, { recursive: true, force: true });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ commits }));
          } catch (cloneErr) {
            console.error(`[Server] Error cloning/harvesting remote:`, cloneErr.message);
            
            // Ensure temp folder is cleaned up even if step failed
            if (fs.existsSync(tempPath)) {
              fs.rmSync(tempPath, { recursive: true, force: true });
            }
            
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Failed to load remote repository: ${cloneErr.message}` }));
          }
        } else {
          // Local path harvesting
          // Check if path is relative, make absolute relative to workspace root if so
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
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found.' }));
  }
});

server.listen(PORT, () => {
  console.log(`[Server] Git Harvester Service running at http://localhost:${PORT}`);
});
