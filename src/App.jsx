import React, { useState, useMemo } from 'react';
import RewindCanvas from './components/RewindCanvas';
import FileTree from './components/FileTree';
import CodeViewer from './components/CodeViewer';
import sampleGitHistory from './data/gitHistory.json';
import './App.css';

export default function App() {
  const [commits, setCommits] = useState(null); // Loaded commit history
  const [repoInput, setRepoInput] = useState(''); // Text input value
  const [isLoading, setIsLoading] = useState(false); // Loading state indicator
  const [loadingStatus, setLoadingStatus] = useState(''); // Text for loading status
  const [errorMessage, setErrorMessage] = useState(''); // Error feedback message

  const [showJson, setShowJson] = useState(false);
  const [showIde, setShowIde] = useState(true);
  const [selectedFilePath, setSelectedFilePath] = useState(null);

  // Sort commits chronologically (oldest first)
  const sortedCommits = useMemo(() => {
    if (!commits) return [];
    return [...commits].sort((a, b) => a.timestamp - b.timestamp);
  }, [commits]);

  // Time-travel index: starts at the most recent commit
  const [sliderVal, setSliderVal] = useState(0);

  // Dynamically update the slider default value when new commits are loaded
  const updateCommits = (newCommits) => {
    setCommits(newCommits);
    setSliderVal(newCommits.length > 0 ? newCommits.length - 1 : 0);
    setSelectedFilePath(null);
  };

  // Reconstruct file explorer state at selected timeline
  const filesAtCommit = useMemo(() => {
    const fileStates = {};
    for (let i = 0; i <= sliderVal; i++) {
      const commit = sortedCommits[i];
      if (!commit) continue;
      commit.details.forEach(detail => {
        if (detail.status.startsWith('D')) {
          delete fileStates[detail.path];
        } else {
          fileStates[detail.path] = {
            path: detail.path,
            status: detail.status,
            content: detail.content || '',
            commitId: commit.id,
            commitMessage: commit.message,
            author: commit.author,
            timestamp: commit.timestamp
          };
        }
      });
    }
    return Object.values(fileStates);
  }, [sliderVal, sortedCommits]);

  // Current selected file details
  const selectedFile = useMemo(() => {
    if (!selectedFilePath) return null;
    return filesAtCommit.find(f => f.path === selectedFilePath) || null;
  }, [selectedFilePath, filesAtCommit]);

  // Content of selected file at parent commit (for diff calculations)
  const previousContent = useMemo(() => {
    if (!selectedFile) return '';
    // Scan backwards from commit index to find previous revision of file
    for (let i = sliderVal - 1; i >= 0; i--) {
      const commit = sortedCommits[i];
      if (!commit) continue;
      const match = commit.details.find(d => d.path === selectedFile.path);
      if (match) {
        return match.content || '';
      }
    }
    return '';
  }, [selectedFile, sliderVal, sortedCommits]);

  // Generate real-time mock git output inside the integrated terminal
  const terminalContent = useMemo(() => {
    const activeCommit = sortedCommits[sliderVal];
    if (!activeCommit) return 'guest@rewind-git:~/workspace$ ';
    
    const dateStr = new Date(activeCommit.timestamp * 1000).toLocaleString();
    const additions = activeCommit.additions || 0;
    const deletions = activeCommit.deletions || 0;

    const fileSummaryLines = activeCommit.details.map(d => {
      const sign = d.status.startsWith('A') ? 'A' : d.status.startsWith('D') ? 'D' : 'M';
      return ` [${sign}]  ${d.path}`;
    });

    return [
      `guest@rewind-git:~/workspace$ git show --stat --oneline ${activeCommit.id.substring(0, 7)}`,
      `${activeCommit.id.substring(0, 7)} - ${activeCommit.message}`,
      `Author: ${activeCommit.author}`,
      `Date:   ${dateStr}`,
      ``,
      `File changes:`,
      ...fileSummaryLines,
      ``,
      `Summary: ${activeCommit.details.length} files changed, +${additions} insertions, -${deletions} deletions`,
      `guest@rewind-git:~/workspace$ █`
    ].join('\n');
  }, [sortedCommits, sliderVal]);

  // Handle repository submission form
  const handleLoadRepository = async (e) => {
    if (e) e.preventDefault();
    const input = repoInput.trim();
    if (!input) return;

    setIsLoading(true);
    setErrorMessage('');
    
    const isRemote = input.startsWith('http://') || 
                     input.startsWith('https://') || 
                     input.startsWith('git@') ||
                     input.startsWith('ssh://');

    setLoadingStatus(isRemote ? 'Cloning remote repository (shallow depth)...' : 'Harvesting local repository log details...');

    try {
      const response = await fetch('http://localhost:3001/api/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: input })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to harvest history.');
      }

      setLoadingStatus('Structuring logs and code files...');
      const data = await response.json();
      
      if (!data.commits || data.commits.length === 0) {
        throw new Error('No commits were found in the specified repository.');
      }

      updateCommits(data.commits);
    } catch (err) {
      console.error(err);
      setErrorMessage(err.message || 'Failed to connect to local harvester backend. Ensure "node server.js" is running.');
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  // Load the pre-harvested sample dataset
  const handleLoadSampleData = () => {
    setIsLoading(true);
    setErrorMessage('');
    setTimeout(() => {
      updateCommits(sampleGitHistory);
      setIsLoading(false);
    }, 400);
  };

  // Return to landing page
  const handleResetRepo = () => {
    setCommits(null);
    setRepoInput('');
    setErrorMessage('');
  };

  // Derive statistics
  const totalCommits = sortedCommits.length;
  const authors = [...new Set(sortedCommits.map(c => c.author))];
  const totalFilesChanged = sortedCommits.reduce((acc, c) => acc + (c.details?.length || 0), 0);

  // ----------------------------------------------------
  // LANDING PAGE RENDER
  // ----------------------------------------------------
  if (!commits) {
    return (
      <div className="landing-page-container">
        <div className="landing-background-overlay"></div>
        <div className="landing-card-glow"></div>

        <div className="landing-content">
          <div className="landing-header">
            <span className="logo-text large">rewind<span className="logo-dot">.git</span></span>
            <span className="badge">v1.0.0-beta</span>
          </div>

          <h1 className="landing-tagline">
            Turn your Git repository into a <span className="highlight-text-cyan">dark-mode time-traveling canvas</span>
          </h1>
          <p className="landing-subtitle">
            An open-source developer tool visualizing logs as an interactive force-directed node-physics simulation. Traverse history, explore file trees, and inspect line changes.
          </p>

          <form className="landing-form" onSubmit={handleLoadRepository}>
            <div className="input-group">
              <span className="terminal-prompt-symbol">&gt;</span>
              <input
                type="text"
                placeholder="Enter absolute local path or GitHub HTTPS URL..."
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            
            <div className="landing-actions">
              <button type="submit" className="btn-visualize" disabled={isLoading || !repoInput.trim()}>
                {isLoading ? 'Processing...' : 'Visualize History'}
              </button>
              <button type="button" className="btn-sample" onClick={handleLoadSampleData} disabled={isLoading}>
                Try Sample Dataset
              </button>
            </div>
          </form>

          {isLoading && (
            <div className="loading-state-wrapper">
              <div className="loader"></div>
              <p className="loading-status-text">{loadingStatus}</p>
            </div>
          )}

          {errorMessage && (
            <div className="error-state-wrapper">
              <span className="error-icon">⚠️</span>
              <p className="error-text">{errorMessage}</p>
            </div>
          )}

          {/* Features Grid */}
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">⚛️</div>
              <h4>Antigravity Physics</h4>
              <p>Force-directed nodes push and pull branch lanes organically via spring simulations.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🕒</div>
              <h4>Time-Travel Timelines</h4>
              <p>Scrub back and forth to watch branches sprout outward or collapse dynamically.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">📁</div>
              <h4>IDE File Tree & Diffs</h4>
              <p>Explore directory paths and audit color-coded line changes at any commit point.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // VISUALIZER WORKSPACE RENDER
  // ----------------------------------------------------
  return (
    <div className="rewind-app dark-theme">
      {/* Sleek top dashboard header */}
      <header className="app-header">
        <div className="logo-group">
          <div className="logo-glow"></div>
          <span className="logo-text" onClick={handleResetRepo} style={{ cursor: 'pointer' }}>
            rewind<span className="logo-dot">.git</span>
          </span>
          <span className="badge">v1.0.0-beta</span>
        </div>
        
        <div className="header-stats">
          <div className="stat-pill">
            <span className="stat-label">Commits</span>
            <span className="stat-val text-cyan">{totalCommits}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-label">Contributors</span>
            <span className="stat-val text-purple">{authors.length}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-label">Files Tracked</span>
            <span className="stat-val text-amber">{totalFilesChanged}</span>
          </div>
          <button 
            className={`ide-toggle-btn ${showIde ? 'active' : ''}`}
            onClick={() => setShowIde(!showIde)}
          >
            {showIde ? 'Hide Workspace' : 'Open Workspace'}
          </button>
          <button 
            className="change-repo-btn"
            onClick={handleResetRepo}
          >
            Change Repository
          </button>
        </div>
      </header>

      {/* Main Workspace layout */}
      <main className="app-main">
        {/* Sidebar panels */}
        <aside className="control-sidebar">
          <div className="sidebar-card">
            <h3>Overview</h3>
            <p className="description">
              A highly visual, interactive time-traveling canvas mapping git log histories to an antigravity node-physics simulation.
            </p>
          </div>

          {/* Branch color codes legend */}
          <div className="sidebar-card">
            <h3>Branches</h3>
            <ul className="branch-legend">
              <li>
                <span className="legend-indicator dot-cyan"></span>
                <span className="legend-label">Main Trunk</span>
                <span className="legend-code">Cyan</span>
              </li>
              <li>
                <span className="legend-indicator dot-purple"></span>
                <span className="legend-label">Feature Paths</span>
                <span className="legend-code">Purple</span>
              </li>
              <li>
                <span className="legend-indicator dot-amber"></span>
                <span className="legend-label">Hotfixes</span>
                <span className="legend-code">Amber</span>
              </li>
            </ul>
          </div>

          {/* Interactivity Instructions */}
          <div className="sidebar-card">
            <h3>Controls</h3>
            <ul className="controls-list">
              <li><strong>Scroll Wheel</strong> Zoom in / out</li>
              <li><strong>Drag Canvas</strong> Pan across the history</li>
              <li><strong>Drag Node</strong> Freeze and position node</li>
              <li><strong>Hover Node</strong> Inspect files & author HUD</li>
              <li><strong>Range Slider</strong> Move backward/forward in time</li>
            </ul>
          </div>

          {/* Raw JSON Data Drawer Toggle */}
          <div className="sidebar-card collapsible">
            <div className="card-header-toggle" onClick={() => setShowJson(!showJson)}>
              <h3>Raw Git Payload</h3>
              <span className="toggle-icon">{showJson ? '▼' : '►'}</span>
            </div>
            {showJson && (
              <div className="payload-json-wrapper">
                <pre>{JSON.stringify(sortedCommits.slice(0, 3), null, 2)}</pre>
                {sortedCommits.length > 3 && <div className="json-truncation">... truncated {sortedCommits.length - 3} commits</div>}
              </div>
            )}
          </div>
        </aside>

        {/* Dynamic Split Workspace Viewport */}
        <div className="workspace-viewport">
          <section className="visualization-viewport">
            <RewindCanvas 
              commits={sortedCommits} 
              sliderVal={sliderVal} 
              setSliderVal={setSliderVal} 
            />
          </section>

          {/* Code IDE Workspace overlay panel */}
          {showIde && (
            <section className="ide-panel-wrapper">
              <div className="vscode-layout">
                {/* VS Code Sidebar File Explorer */}
                <div className="vscode-sidebar">
                  <div className="section-header">
                    <h4>EXPLORER: REWIND</h4>
                    <span className="file-count-badge">{filesAtCommit.length} files</span>
                  </div>
                  <div className="explorer-body">
                    <FileTree 
                      files={filesAtCommit} 
                      selectedPath={selectedFilePath} 
                      onSelectFile={(file) => setSelectedFilePath(file?.path || null)}
                    />
                  </div>
                </div>

                {/* VS Code Main Editor + Terminal Pane */}
                <div className="vscode-editor-main">
                  <div className="vscode-editor-pane">
                    <CodeViewer 
                      selectedFile={selectedFile} 
                      previousContent={previousContent}
                    />
                  </div>

                  {/* Collapsible VS Code Integrated Terminal Panel */}
                  <div className="vscode-terminal-pane">
                    <div className="terminal-tabs-header">
                      <div className="terminal-tab active">Terminal</div>
                      <div className="terminal-tab">Output</div>
                      <span className="terminal-prompt-info">bash (git show)</span>
                    </div>
                    <div className="terminal-body-content">
                      <pre className="terminal-pre">{terminalContent}</pre>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
