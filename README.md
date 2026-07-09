# rewind.git 🕒 ⚛️

**rewind.git** is an open-source, highly visual, dark-mode time-traveling canvas that turns your local or remote Git repository's history into an interactive node-physics simulation. Traverse your commit history, explore code trees, and audit code diffs using a pixel-perfect VS Code dashboard or directly in your console terminal.

---

## 🚀 Key Features

* **⚛️ Antigravity Node-Physics Simulation**  
  An interactive HTML5 Canvas that structures branches (Main Trunk, Feature Paths, Hotfixes) as force-directed spring networks. Drag to anchor, scroll to zoom, and hover to view glassmorphic metadata HUDs.
  
* **💻 VS Code-Style Workspace**  
  Includes a pixel-perfect replica of the VS Code layout:
  * **File Explorer Sidebar**: Folder expansions (`▶`/`▼`), file type icons, and status badges (`A` for Added, `M` for Modified).
  * **Code Editor Pane**: VS Code Dark+ theme syntax highlights with active tab selectors.
  * **Line-by-Line Diffs**: Color-coded code additions (green) and deletions (red) matching standard code reviews.

* **📟 Integrated Git Terminal**  
  A built-in bash terminal console at the bottom of the editor. As you scroll through the timeline slider, the terminal outputs real-time Git statistics, authors, timestamps, and commit files (e.g. `git show --stat --oneline`).

* **🔌 Real-Time Harvester Engine**  
  A local backend harvester that reads commit logs, authors, parents, and file structures. Supports local directory inputs and fetches remote repositories automatically via shallow clone processes.

* **👾 CLI Terminal Visualizer**  
  A command-line script (`cli.js`) that renders a beautifully colorized ASCII representation of your branch lines, commits, and logs directly inside your terminal console.

---

## 🛠️ Architecture & Tech Stack

* **Client**: React (with Vite), HTML5 Canvas 2D Context, Custom Force-Directed Spring Layout.
* **Server**: Node.js http (microservice running on port `3001` to interface with the local system).
* **CLI Engine**: Standalone Node CLI parser using ANSI escape sequences.
* **Git integration**: Native shell child processes (`git log`, `git clone`, `git show`).

---

## ⚡ Quick Start

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (v16+) and [Git](https://git-scm.com/) installed on your machine.

### Installation
1. Clone this repository:
   ```bash
   git clone https://github.com/Garvit-821/rewind-git.git
   cd rewind-git
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application
To run the full visual web dashboard:

1. **Start the Backend Harvester Service**:
   ```bash
   node server.js
   ```

2. **Start the Development Client**:
   ```bash
   npm run dev
   ```

3. Open your browser and navigate to **[http://localhost:5173](http://localhost:5173)**. Enter a local absolute path or any public GitHub HTTPS URL to begin time-traveling!

### Running the Terminal Version (CLI Graph)
To visualize a repository's history directly inside your terminal console:
```bash
node cli.js [path-to-git-repository]
```
*(If no path argument is provided, it defaults to the current workspace).*

---

## 📄 License
This project is licensed under the MIT License.
