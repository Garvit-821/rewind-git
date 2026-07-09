import path from 'path';
import { harvest } from './harvester.js';

// ANSI terminal colors
const C_RESET = '\x1b[0m';
const C_BOLD = '\x1b[1m';
const C_CYAN = '\x1b[36m';
const C_MAGENTA = '\x1b[35m';
const C_YELLOW = '\x1b[33m';
const C_GREEN = '\x1b[32m';
const C_RED = '\x1b[31m';
const C_GREY = '\x1b[90m';

async function main() {
  const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  console.log(`${C_BOLD}${C_CYAN}rewind.git - Terminal Harvester CLI${C_RESET}`);
  console.log(`${C_GREY}Target Directory: ${targetDir}${C_RESET}\n`);

  try {
    const commits = await harvest(targetDir);
    if (!commits || commits.length === 0) {
      console.log(`${C_RED}No commits found in target directory.${C_RESET}`);
      return;
    }

    // Sort chronologically (oldest first)
    const sorted = [...commits].sort((a, b) => a.timestamp - b.timestamp);

    // Simple ASCII branch drawer
    // We will assign a virtual track to each active branch line
    const activeLanes = [];
    
    sorted.forEach((commit, idx) => {
      // Find parent lane
      let laneIndex = -1;
      if (commit.parentIds.length > 0) {
        // Find which lane has one of the parents
        laneIndex = activeLanes.findIndex(id => commit.parentIds.includes(id));
      }

      if (laneIndex === -1) {
        // If not found (or root), allocate a new lane
        laneIndex = activeLanes.length;
        activeLanes.push(commit.id);
      } else {
        // Replace parent with this commit
        activeLanes[laneIndex] = commit.id;
      }

      // Draw the ASCII track column
      let graphStr = '';
      for (let i = 0; i < activeLanes.length; i++) {
        if (i === laneIndex) {
          // Draw the node point
          const dotColor = laneIndex === 0 ? C_CYAN : (laneIndex === 1 ? C_MAGENTA : C_YELLOW);
          graphStr += `${dotColor}*${C_RESET} `;
        } else {
          // Draw vertical lane lines
          const lineColor = i === 0 ? C_CYAN : (i === 1 ? C_MAGENTA : C_YELLOW);
          graphStr += `${lineColor}|${C_RESET} `;
        }
      }

      const dateStr = new Date(commit.timestamp * 1000).toLocaleDateString();
      const hashAbbr = commit.id.substring(0, 7);
      
      console.log(
        `${C_GREY}[${idx + 1}/${sorted.length}]${C_RESET} ` +
        `${graphStr.padEnd(16)} ` +
        `${C_CYAN}${hashAbbr}${C_RESET} ` +
        `(${C_YELLOW}${commit.author}${C_RESET}) ` +
        `[${C_GREEN}${dateStr}${C_RESET}] ` +
        `${C_BOLD}${commit.message}${C_RESET}`
      );
    });

    console.log(`\n${C_GREEN}Successfully visualized ${sorted.length} commits.${C_RESET}`);
  } catch (err) {
    console.error(`\n${C_RED}Error: ${err.message}${C_RESET}`);
    process.exit(1);
  }
}

main();
