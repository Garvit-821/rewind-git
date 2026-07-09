import React, { useState, useMemo } from 'react';

// Icons for folders and files styled like VS Code Explorer
const FolderIcon = ({ isOpen }) => (
  <>
    <span className="vscode-arrow" style={{ fontSize: '9px', width: '12px', display: 'inline-block', color: '#858585', marginRight: '4px' }}>
      {isOpen ? '▼' : '▶'}
    </span>
    <span className="icon folder-icon" style={{ marginRight: '6px', color: '#e8a838', fontSize: '13px' }}>
      {isOpen ? '📂' : '📁'}
    </span>
  </>
);

const FileIcon = ({ fileName }) => {
  let emoji = '📄';
  if (fileName.endsWith('.js') || fileName.endsWith('.jsx')) emoji = '🟨';
  else if (fileName.endsWith('.css')) emoji = '🔵';
  else if (fileName.endsWith('.json')) emoji = '⚙️';
  else if (fileName.endsWith('.md')) emoji = '📝';
  
  return (
    <>
      <span className="vscode-arrow-spacer" style={{ width: '12px', display: 'inline-block', marginRight: '4px' }}></span>
      <span className="icon file-icon" style={{ marginRight: '6px', fontSize: '12px' }}>{emoji}</span>
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
