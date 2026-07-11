import React, { useState, useMemo, useEffect } from 'react';
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

  const [fileContentsCache, setFileContentsCache] = useState({});

  // Helper to fetch file content dynamically from backend
  const fetchFileContent = async (commitId, filePath) => {
    if (!repoInput) return '';
    const cacheKey = `${commitId}:${filePath}`;
    if (fileContentsCache[cacheKey] !== undefined) {
      return fileContentsCache[cacheKey];
    }

    try {
      const response = await fetch('http://localhost:3001/api/file-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath: repoInput || 'sample',
          commitId,
          filePath
        })
      });
      if (!response.ok) throw new Error('Failed to load file');
      const data = await response.json();
      setFileContentsCache(prev => ({
        ...prev,
        [cacheKey]: data.content
      }));
      return data.content;
    } catch (err) {
      console.error(err);
      return '';
    }
  };

  // Dynamically update the slider default value when new commits are loaded
  const updateCommits = (newCommits) => {
    setCommits(newCommits);
    setSliderVal(newCommits.length > 0 ? newCommits.length - 1 : 0);
    setSelectedFilePath(null);
    setFileContentsCache({}); // Reset cache
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
          const cacheKey = `${commit.id}:${detail.path}`;
          const contentVal = fileContentsCache[cacheKey] !== undefined 
            ? fileContentsCache[cacheKey] 
            : (detail.content || '');

          fileStates[detail.path] = {
            path: detail.path,
            status: detail.status,
            content: contentVal,
            commitId: commit.id,
            commitMessage: commit.message,
            author: commit.author,
            timestamp: commit.timestamp
          };
        }
      });
    }
    return Object.values(fileStates);
  }, [sliderVal, sortedCommits, fileContentsCache]);

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
        const cacheKey = `${commit.id}:${selectedFile.path}`;
        if (fileContentsCache[cacheKey] !== undefined) {
          return fileContentsCache[cacheKey];
        }
        return match.content || '';
      }
    }
    return '';
  }, [selectedFile, sliderVal, sortedCommits, fileContentsCache]);

  // Trigger on-demand fetching of active file contents
  useEffect(() => {
    if (!selectedFilePath || !selectedFile) return;
    
    // Load current version
    fetchFileContent(selectedFile.commitId, selectedFile.path);

    // Load previous version (for diff calculations)
    if (sliderVal > 0) {
      let prevCommitId = null;
      for (let i = sliderVal - 1; i >= 0; i--) {
        const commit = sortedCommits[i];
        if (!commit) continue;
        const match = commit.details.find(d => d.path === selectedFile.path);
        if (match) {
          prevCommitId = commit.id;
          break;
        }
      }
      if (prevCommitId) {
        fetchFileContent(prevCommitId, selectedFile.path);
      }
    }
  }, [selectedFilePath, sliderVal, selectedFile, sortedCommits]);

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
    setFileContentsCache({});
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
        <video 
          className="landing-video-bg" 
          autoPlay 
          loop 
          muted 
          playsInline
        >
          <source src="/bg.mp4" type="video/mp4" />
        </video>
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

        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // VISUALIZER WORKSPACE RENDER
  // ----------------------------------------------------
  // Colorized terminal output renderer
  const renderTerminalContent = () => {
    const activeCommit = sortedCommits[sliderVal];
    if (!activeCommit) {
      return (
        <div>
          <span style={{ color: '#4ade80', fontWeight: 'bold' }}>guest@rewind-git:~/workspace$ </span>
          <span style={{ color: '#ffffff' }}>█</span>
        </div>
      );
    }
    
    const dateStr = new Date(activeCommit.timestamp * 1000).toLocaleString();
    const additions = activeCommit.additions || 0;
    const deletions = activeCommit.deletions || 0;

    return (
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: '1.6', color: '#d4d4d4' }}>
        <div>
          <span style={{ color: '#4ade80', fontWeight: 'bold' }}>guest@rewind-git:~/workspace$ </span>
          <span style={{ color: '#ffffff' }}>git show --stat --oneline {activeCommit.id.substring(0, 7)}</span>
        </div>
        <div>
          <span style={{ color: '#00f2fe', fontWeight: 'bold' }}>{activeCommit.id.substring(0, 7)}</span>
          <span style={{ color: '#e2e8f0' }}> - {activeCommit.message}</span>
        </div>
        <div>
          <span style={{ color: '#9ca3af' }}>Author: </span>
          <span style={{ color: '#f3f4f6' }}>{activeCommit.author}</span>
        </div>
        <div>
          <span style={{ color: '#9ca3af' }}>Date:   </span>
          <span style={{ color: '#f3f4f6' }}>{dateStr}</span>
        </div>
        <div style={{ margin: '8px 0 4px 0', color: '#9ca3af', textDecoration: 'underline' }}>File changes:</div>
        {activeCommit.details.map((d, idx) => {
          const isAdd = d.status.startsWith('A');
          const isDel = d.status.startsWith('D');
          const signColor = isAdd ? '#10b981' : isDel ? '#ef4444' : '#fbbf24';
          const sign = isAdd ? 'A' : isDel ? 'D' : 'M';
          return (
            <div key={idx} style={{ paddingLeft: '8px' }}>
              <span style={{ color: signColor, fontWeight: 'bold' }}>[{sign}]</span>
              <span style={{ color: '#cbd5e1' }}>  {d.path}</span>
            </div>
          );
        })}
        <div style={{ marginTop: '8px', color: '#9ca3af' }}>
          <span>Summary: {activeCommit.details.length} files changed, </span>
          <span style={{ color: '#10b981', fontWeight: 'bold' }}>+{additions} insertions</span>
          <span>, </span>
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>-{deletions} deletions</span>
        </div>
        <div style={{ marginTop: '8px' }}>
          <span style={{ color: '#4ade80', fontWeight: 'bold' }}>guest@rewind-git:~/workspace$ </span>
          <span style={{ color: '#ffffff' }}>█</span>
        </div>
      </div>
    );
  };

  // ----------------------------------------------------
  // VISUALIZER WORKSPACE RENDER
  // ----------------------------------------------------
  return (
    <div className="rewind-app dark-theme">
      {/* Main Workspace layout */}
      <main className="app-main" style={{ height: '100vh', width: '100vw' }}>
        {/* Dynamic Split Workspace Viewport */}
        <div className="workspace-viewport">
          <section className="visualization-viewport">
            <RewindCanvas 
              commits={sortedCommits} 
              sliderVal={sliderVal} 
              setSliderVal={setSliderVal} 
              repoInput={repoInput}
            />

            {/* Floating Toggle Workspace Button */}
            <button
              onClick={() => setShowIde(!showIde)}
              style={{
                position: 'absolute',
                right: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(30, 41, 59, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRight: 'none',
                borderRadius: '8px 0 0 8px',
                color: '#ffffff',
                padding: '16px 8px',
                cursor: 'pointer',
                zIndex: 20,
                backdropFilter: 'blur(12px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
                boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.3)'
              }}
              title={showIde ? 'Hide IDE Workspace' : 'Open IDE Workspace'}
            >
              {showIde ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              )}
            </button>
          </section>

          {/* Code IDE Workspace overlay panel */}
          {showIde && (
            <section className="ide-panel-wrapper">
              <div className="vscode-layout">
                {/* VS Code Activity Bar */}
                <div className="vscode-activity-bar">
                  {/* Top Icons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', alignItems: 'center' }}>
                    {/* Explorer - Active (with indicator line on the left) */}
                    <div 
                      style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center', cursor: 'pointer' }}
                      onClick={() => setShowIde(false)}
                      title="Collapse Explorer"
                    >
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '2px', backgroundColor: '#00f2fe' }} />
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 22V4a2 2 0 0 1 2-2h8.5L20 7.5V22a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>

                    {/* Search */}
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'center', cursor: 'pointer', opacity: 0.45 }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    </div>

                    {/* Source Control */}
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'center', cursor: 'pointer', opacity: 0.45 }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="18" cy="18" r="3" />
                        <circle cx="6" cy="6" r="3" />
                        <path d="M18 15V9a4 4 0 0 0-4-4H9" />
                        <line x1="6" y1="9" x2="6" y2="21" />
                      </svg>
                    </div>

                    {/* Run / Debug */}
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'center', cursor: 'pointer', opacity: 0.45 }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </div>

                    {/* Extensions */}
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'center', cursor: 'pointer', opacity: 0.45 }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" />
                        <rect x="14" y="3" width="7" height="7" />
                        <rect x="14" y="14" width="7" height="7" />
                        <rect x="3" y="14" width="7" height="7" />
                      </svg>
                    </div>
                  </div>

                  {/* Bottom Icons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', alignItems: 'center' }}>
                    {/* User profile */}
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'center', cursor: 'pointer', opacity: 0.45 }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </div>

                    {/* Settings / Gear */}
                    <div 
                      style={{ width: '100%', display: 'flex', justifyContent: 'center', cursor: 'pointer', opacity: 0.45 }}
                      onClick={handleResetRepo}
                      title="Choose another repository"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                    </div>
                  </div>
                </div>

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
                      {renderTerminalContent()}
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
