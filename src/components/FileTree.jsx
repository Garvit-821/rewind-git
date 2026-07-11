import React, { useState, useMemo } from 'react';

// Icons for folders and files styled like VS Code Explorer
// Icons for folders and files styled like VS Code Explorer
const FolderIcon = ({ isOpen }) => (
  <>
    <span className="vscode-arrow" style={{ fontSize: '9px', width: '12px', display: 'inline-block', color: '#858585', marginRight: '4px' }}>
      {isOpen ? '▼' : '▶'}
    </span>
    <svg width="16" height="16" viewBox="0 0 24 24" fill={isOpen ? '#e8a838' : 'none'} stroke="#e8a838" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', alignSelf: 'center' }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  </>
);

const FileIcon = ({ fileName }) => {
  let color = '#a1a1aa';
  let iconContent = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ alignSelf: 'center' }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );

  if (fileName.endsWith('.js') || fileName.endsWith('.jsx')) {
    color = '#f1e05a';
    iconContent = (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ alignSelf: 'center' }}>
        <rect x="0" y="0" width="24" height="24" rx="3" fill="#f1e05a" />
        <text x="12" y="17" fill="#000000" fontSize="13" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">JS</text>
      </svg>
    );
  } else if (fileName.endsWith('.css')) {
    color = '#569cd6';
    iconContent = (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ alignSelf: 'center' }}>
        <rect x="0" y="0" width="24" height="24" rx="3" fill="#569cd6" />
        <text x="12" y="17" fill="#ffffff" fontSize="12" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">#</text>
      </svg>
    );
  } else if (fileName.endsWith('.json') || fileName.includes('config')) {
    color = '#f87171';
    iconContent = (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" style={{ alignSelf: 'center' }}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    );
  } else if (fileName.endsWith('.md')) {
    color = '#007acc';
    iconContent = (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ alignSelf: 'center' }}>
        <rect x="0" y="0" width="24" height="24" rx="3" fill="#007acc" />
        <text x="12" y="16" fill="#ffffff" fontSize="11" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">M↓</text>
      </svg>
    );
  }

  return (
    <>
      <span className="vscode-arrow-spacer" style={{ width: '12px', display: 'inline-block', marginRight: '4px' }}></span>
      <span className="icon file-icon" style={{ marginRight: '6px', display: 'inline-flex', alignItems: 'center', color }}>
        {iconContent}
      </span>
    </>
  );
};

export default function FileTree({ files, selectedPath, onSelectFile }) {
  // Store expansion state of folders
  const [expandedFolders, setExpandedFolders] = useState({ 'Root': true });

  const toggleFolder = (path) => {
    setExpandedFolders(prev => ({
      ...prev,
      [path]: !prev[path]
    }));
  };

  // Convert flat files list to a tree structure
  const treeData = useMemo(() => {
    const root = { name: 'Root', path: 'Root', type: 'directory', children: {} };
    
    files.forEach(file => {
      const parts = file.path.split('/');
      let current = root;
      
      parts.forEach((part, idx) => {
        const isLast = idx === parts.length - 1;
        const currentPath = parts.slice(0, idx + 1).join('/');
        
        if (!current.children[part]) {
          current.children[part] = {
            name: part,
            path: currentPath,
            type: isLast ? 'file' : 'directory',
            children: isLast ? null : {},
            fileData: isLast ? file : null
          };
        }
        current = current.children[part];
      });
    });

    // Helper to sort and flatten children map to arrays
    const sortAndFlatten = (node) => {
      if (node.children) {
        const sorted = Object.values(node.children).sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
        sorted.forEach(sortAndFlatten);
        node.children = sorted;
      }
    };
    
    sortAndFlatten(root);
    return Object.values(root.children);
  }, [files]);

  // Recursive Tree Node Renderer
  const renderNode = (node, depth = 0) => {
    const isFolder = node.type === 'directory';
    const isOpen = expandedFolders[node.path];
    const isSelected = selectedPath === node.path;

    return (
      <div key={node.path} className="tree-node-wrapper">
        <div 
          className={`tree-node ${isFolder ? 'node-folder' : 'node-file'} ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
          onClick={() => {
            if (isFolder) {
              toggleFolder(node.path);
            } else {
              onSelectFile(node.fileData);
            }
          }}
        >
          {isFolder ? <FolderIcon isOpen={isOpen} /> : <FileIcon fileName={node.name} />}
          <span className="node-name">{node.name}</span>
          {!isFolder && node.fileData.status && (
            <span className={`status-badge badge-${node.fileData.status.toLowerCase()}`}>
              {node.fileData.status}
            </span>
          )}
        </div>

        {isFolder && isOpen && node.children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="file-tree-container">
      {treeData.length > 0 ? (
        treeData.map(node => renderNode(node, 0))
      ) : (
        <div className="empty-tree">No files in directory</div>
      )}
    </div>
  );
}
