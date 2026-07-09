import React, { useState, useMemo } from 'react';

// A simple, fast line-by-line diff algorithm to compute additions and deletions
function computeDiff(oldText, newText) {
  const oldLines = oldText ? oldText.split(/\r?\n/) : [];
  const newLines = newText ? newText.split(/\r?\n/) : [];
  
  const diff = [];
  let i = 0, j = 0;
  
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length) {
      if (oldLines[i] === newLines[j]) {
        diff.push({ type: 'normal', text: oldLines[i], oldLineNum: i + 1, newLineNum: j + 1 });
        i++;
        j++;
      } else {
        // Lookahead to find matching lines
        let foundMatch = false;
        const lookaheadLimit = 15;
        
        for (let k = 1; k <= lookaheadLimit; k++) {
          if (i + k < oldLines.length && oldLines[i + k] === newLines[j]) {
            // Lines from i to i + k were deleted
            for (let m = 0; m < k; m++) {
              diff.push({ type: 'delete', text: oldLines[i + m], oldLineNum: i + m + 1 });
            }
            i += k;
            foundMatch = true;
            break;
          }
          if (j + k < newLines.length && oldLines[i] === newLines[j + k]) {
            // Lines from j to j + k were added
            for (let m = 0; m < k; m++) {
              diff.push({ type: 'add', text: newLines[j + m], newLineNum: j + m + 1 });
            }
            j += k;
            foundMatch = true;
            break;
          }
        }
        
        if (!foundMatch) {
          // If no match found within limit, treat as substitution (delete then add)
          diff.push({ type: 'delete', text: oldLines[i], oldLineNum: i + 1 });
          diff.push({ type: 'add', text: newLines[j], newLineNum: j + 1 });
          i++;
          j++;
        }
      }
    } else if (i < oldLines.length) {
      diff.push({ type: 'delete', text: oldLines[i], oldLineNum: i + 1 });
      i++;
    } else {
      diff.push({ type: 'add', text: newLines[j], newLineNum: j + 1 });
      j++;
    }
  }
  return diff;
}

// Lightweight regex syntax highlighter
function highlightLine(text, filePath) {
  if (text === "") return "&nbsp;";
  
  // Escape HTML tags to prevent injections and canvas clashes
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
    
  // Highlight syntax for code files
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx') || filePath.endsWith('.json') || filePath.endsWith('.css')) {
    // Comments
    html = html.replace(/(\/\/.*)/g, '<span class="syntax-comment">$1</span>');
    
    // Strings in quotes or backticks
    html = html.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="syntax-string">$1</span>');
    html = html.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="syntax-string">$1</span>');
    html = html.replace(/(`(?:[^`\\]|\\.)*`)/g, '<span class="syntax-string">$1</span>');
    
    // Core Language Keywords
    const keywords = /\b(const|let|var|function|return|import|export|default|class|extends|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|this|typeof|instanceof|async|await|true|false|null|undefined|from)\b/g;
    html = html.replace(keywords, '<span class="syntax-keyword">$1</span>');
    
    // JSX elements
    html = html.replace(/(&lt;[a-zA-Z0-9_]+)/g, '<span class="syntax-tag">$1</span>');
    html = html.replace(/(&lt;\/[a-zA-Z0-9_]+&gt;)/g, '<span class="syntax-tag">$1</span>');
  } else if (filePath.endsWith('.md')) {
    // Headers
    html = html.replace(/^(#+.*)/g, '<span class="syntax-header">$1</span>');
    // Bold tokens
    html = html.replace(/(\*\*.*?\*\*)/g, '<span class="syntax-bold">$1</span>');
  }
  return html;
}

export default function CodeViewer({ selectedFile, previousContent }) {
  const [viewMode, setViewMode] = useState('source'); // 'source' or 'diff'
  
  const diffLines = useMemo(() => {
    if (!selectedFile) return [];
    return computeDiff(previousContent, selectedFile.content);
  }, [selectedFile, previousContent]);

  if (!selectedFile) {
    return (
      <div className="code-viewer-empty">
        <div className="terminal-prompt">&gt;_</div>
        <h3>Select a file from the tree to view contents</h3>
        <p>Use the Git timeline to travel back and forth and see the file system evolve.</p>
      </div>
    );
  }

  const { path: filePath, content, commitId, commitMessage, author, timestamp } = selectedFile;
  const lines = content ? content.split(/\r?\n/) : [];

  return (
    <div className="code-viewer-panel">
      {/* Code Viewer Panel Header */}
      <div className="viewer-header">
        <div className="file-info">
          <span className="file-path-title">{filePath}</span>
          <span className="commit-tag">last updated in {commitId.substring(0, 7)}</span>
        </div>
        
        <div className="view-mode-tabs">
          <button 
            className={`tab-btn ${viewMode === 'source' ? 'active' : ''}`}
            onClick={() => setViewMode('source')}
          >
            Source
          </button>
          <button 
            className={`tab-btn ${viewMode === 'diff' ? 'active' : ''}`}
            onClick={() => setViewMode('diff')}
          >
            Commit Diff
          </button>
        </div>
      </div>

      {/* Commit metadata details */}
      <div className="metadata-banner">
        <div className="meta-row">
          <span className="meta-label">Author:</span> <span className="meta-value">{author}</span>
          <span className="meta-divider">|</span>
          <span className="meta-label">Date:</span> <span className="meta-value">{new Date(timestamp * 1000).toLocaleString()}</span>
        </div>
        <div className="meta-row message-row">
          <span className="meta-label">Message:</span> <span className="meta-value message-text">"{commitMessage}"</span>
        </div>
      </div>

      {/* Code Text Content Area */}
      <div className="code-body-wrapper">
        {viewMode === 'source' ? (
          <div className="code-source-view">
            <div className="line-numbers-gutter">
              {lines.map((_, i) => (
                <div key={i} className="line-number">{i + 1}</div>
              ))}
            </div>
            <pre className="code-pre">
              {lines.map((line, i) => (
                <code 
                  key={i} 
                  className="code-line" 
                  dangerouslySetInnerHTML={{ __html: highlightLine(line, filePath) }} 
                />
              ))}
            </pre>
          </div>
        ) : (
          <div className="code-diff-view">
            <table className="diff-table">
              <tbody>
                {diffLines.map((line, idx) => {
                  let lineClass = 'diff-line-normal';
                  let symbol = ' ';
                  if (line.type === 'add') {
                    lineClass = 'diff-line-add';
                    symbol = '+';
                  } else if (line.type === 'delete') {
                    lineClass = 'diff-line-delete';
                    symbol = '-';
                  }

                  return (
                    <tr key={idx} className={lineClass}>
                      <td className="diff-line-num old-num">{line.oldLineNum || ''}</td>
                      <td className="diff-line-num new-num">{line.newLineNum || ''}</td>
                      <td className="diff-sign">{symbol}</td>
                      <td className="diff-text-cell">
                        <pre className="diff-text-pre">
                          <code dangerouslySetInnerHTML={{ __html: highlightLine(line.text, filePath) }} />
                        </pre>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
