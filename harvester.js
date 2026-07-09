#!/usr/bin/env node

/**
 * Rewind Harvester CLI
 * Parses git logs into a structured JSON dataset for interactive node-link visualization.
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Helper to log errors to stderr so stdout remains clean JSON
function logError(msg) {
  console.error(`\x1b[31m[Error]\x1b[0m ${msg}`);
}

// Helper to log info to stderr
function logInfo(msg) {
  console.error(`\x1b[34m[Info]\x1b[0m ${msg}`);
}

/**
 * Executes Git CLI and parses the raw stream into structured commits.
 * Also fetches file contents for each non-deleted file at each commit.
 * 
 * @param {string} repoPath Path to the target Git repository
 * @returns {Promise<Array>} Array of parsed commit objects
 */
function getFileContent(repoPath, commitId, filePath) {
  return new Promise((resolve) => {
    // Wrap filePath in quotes to handle spaces
    exec(`git show ${commitId}:"${filePath}"`, { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve(""); // Fallback for deleted or binary files
      } else {
        resolve(stdout);
      }
    });
  });
}

export function harvest(repoPath = process.cwd()) {
  return new Promise((resolve, reject) => {
    // Check if the directory exists
    if (!fs.existsSync(repoPath)) {
      reject(new Error(`Target path does not exist: ${repoPath}`));
      return;
    }

    // Command to output commit metadata followed by raw status of changes
    const cmd = 'git log --pretty=format:"%H|%P|%an|%at|%s" --raw';
    
    // Set a generous maxBuffer size (10MB) for larger Git repositories
    exec(cmd, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (stderr.includes('not a git repository') || error.message.includes('not a git repository')) {
          reject(new Error(`The directory "${repoPath}" is not a Git repository.`));
        } else if (stderr.includes('does not have any commits') || error.message.includes('does not have any commits')) {
          resolve([]);
        } else {
          reject(new Error(`Failed to execute git log: ${stderr || error.message}`));
        }
        return;
      }
      
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
                
                currentCommit.details.push({
                  status: statusToken,
                  path: pathPart
                });
                
                if (statusToken.startsWith('A')) {
                  currentCommit.additions++;
                } else if (statusToken.startsWith('D')) {
                  currentCommit.deletions++;
                } else {
                  currentCommit.modifications++;
                }
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
          
          currentCommit = {
            id,
            parentIds,
            author,
            timestamp: timestampVal,
            message,
            filesChanged: 0,
            additions: 0,
            deletions: 0,
            modifications: 0,
            details: []
          };
        }
      }
      
      if (currentCommit) {
        currentCommit.filesChanged = currentCommit.additions + currentCommit.deletions;
        commits.push(currentCommit);
      }
      
      resolve(commits);
    });
  });
}


// CLI Execution Setup
const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  let outputFilePath = null;
  let targetRepoPath = process.cwd();
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--output') {
      outputFilePath = args[i + 1];
      i++;
    } else if (args[i] === '-h' || args[i] === '--help') {
      console.log(`
Rewind Harvester CLI
Extracts Git log history as structured JSON.

Usage:
  node harvester.js [repo-path] [options]

Options:
  -o, --output <file>   Write JSON output to a file instead of stdout
  -h, --help            Show this help message
`);
      process.exit(0);
    } else {
      targetRepoPath = args[i];
    }
  }
  
  harvest(targetRepoPath)
    .then(commits => {
      const jsonOutput = JSON.stringify(commits, null, 2);
      if (outputFilePath) {
        const dir = path.dirname(outputFilePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(outputFilePath, jsonOutput, 'utf8');
        logInfo(`Successfully harvested ${commits.length} commits and saved to ${outputFilePath}`);
      } else {
        process.stdout.write(jsonOutput + '\n');
      }
    })
    .catch(err => {
      logError(err.message);
      process.exit(1);
    });
}
