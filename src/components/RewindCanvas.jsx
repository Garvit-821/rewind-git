import React, { useEffect, useRef, useState, useMemo } from 'react';
import CommitTimeline from './CommitTimeline';

// Neon colors assigned to branches
const BRANCH_COLORS = {
  main: '#00f2fe',    // Neon Cyan
  feature: '#d946ef', // Neon Purple/Magenta
  hotfix: '#f59e0b',  // Neon Amber
};

// Physics constants
const K_REPULSION = 150;     // Mild repulsion to prevent aggressive shaking and overlap
const DECAY_SCALE = 80;      // Spatial scale of repulsion decay
const K_SPRING = 0.02;       // Hooke's Law spring coefficient
const REST_LENGTH = 120;     // Preferred link distance
const K_TARGET_X = 0.06;     // Horizontal chronological alignment pull
const K_TARGET_Y = 0.06;     // Vertical branch lane alignment pull
const DAMPING = 0.55;        // Lower damping (higher friction) stabilizes the system rapidly
const VERTICAL_SPACING = 90; // Gap between parallel branch lanes
const HORIZONTAL_SPACING = 150; // Chronological separation

export default function RewindCanvas({ commits, sliderVal, setSliderVal }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Parse and sort commits chronologically (oldest first)
  const sortedCommits = useMemo(() => {
    return [...commits].sort((a, b) => a.timestamp - b.timestamp);
  }, [commits]);
  
  // UI Hover States
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredLeaf, setHoveredLeaf] = useState(null);
  const [hudPos, setHudPos] = useState({ x: 0, y: 0 });

  // Physics and interaction refs (to bypass React re-renders on the physics frame loop)
  const stateRef = useRef({
    nodes: {},         // Map of id -> node
    pan: { x: 50, y: 0 }, // Pan offsets
    zoom: 1.0,         // Zoom factor
    isDraggingCanvas: false,
    dragStart: { x: 0, y: 0 },
    draggedNodeId: null,
    mouse: { x: 0, y: 0 } // Screen space coordinates
  });

  // Assign lanes and branches to each commit
  const commitLayouts = useMemo(() => {
    const layouts = {};
    const activeHeads = {};
    let nextLaneId = 1;

    sortedCommits.forEach((commit) => {
      let lane = 0;
      let branchType = 'main';

      if (commit.parentIds.length > 0) {
        const primaryParentId = commit.parentIds[0];
        const parentLayout = layouts[primaryParentId];
        const parentLane = parentLayout ? parentLayout.lane : 0;

        // If parent's lane is still occupied by this parent, inherit it
        if (activeHeads[parentLane] === primaryParentId) {
          lane = parentLane;
          activeHeads[parentLane] = commit.id;
        } else {
          // Parent lane is taken, branch out to a new lane
          lane = nextLaneId++;
          activeHeads[lane] = commit.id;
        }
      } else {
        // Root commit starts on main line (lane 0)
        lane = 0;
        activeHeads[0] = commit.id;
      }

      // Classify branch type
      if (lane === 0) {
        branchType = 'main';
      } else if (lane % 2 === 1) {
        branchType = 'feature';
      } else {
        branchType = 'hotfix';
      }

      layouts[commit.id] = {
        lane,
        branchType,
        color: BRANCH_COLORS[branchType]
      };
    });

    return layouts;
  }, [sortedCommits]);

  // Synchronize commits array with simulation nodes
  useEffect(() => {
    const s = stateRef.current;
    
    // Initialize nodes if they do not exist
    sortedCommits.forEach((commit, index) => {
      const layout = commitLayouts[commit.id] || { lane: 0, branchType: 'main', color: '#fff' };
      
      // Calculate branch lane offset: main = 0, features go above, hotfixes below
      let yOffset = 0;
      if (layout.lane > 0) {
        const direction = layout.lane % 2 === 1 ? -1 : 1;
        const multiplier = Math.ceil(layout.lane / 2);
        yOffset = direction * multiplier * VERTICAL_SPACING;
      }

      if (!s.nodes[commit.id]) {
        // Spawn node near its parent if parent exists, else center it
        let spawnX = window.innerWidth / 2;
        let spawnY = window.innerHeight / 2;

        if (commit.parentIds.length > 0) {
          const parentNode = s.nodes[commit.parentIds[0]];
          if (parentNode) {
            spawnX = parentNode.x + 30;
            spawnY = parentNode.y + yOffset / 2;
          }
        }

        s.nodes[commit.id] = {
          id: commit.id,
          commit,
          x: spawnX,
          y: spawnY,
          vx: 0,
          vy: 0,
          lane: layout.lane,
          branchType: layout.branchType,
          color: layout.color,
          scale: 0.0,
          opacity: 0.0,
          active: false,
          yOffset
        };
      }
    });

    // Clean up nodes that no longer exist in dataset
    const commitIdSet = new Set(sortedCommits.map(c => c.id));
    Object.keys(s.nodes).forEach(id => {
      if (!commitIdSet.has(id)) {
        delete s.nodes[id];
      }
    });
  }, [sortedCommits, commitLayouts]);

  // Handle active status based on the time slider
  useEffect(() => {
    const s = stateRef.current;
    sortedCommits.forEach((commit, index) => {
      const node = s.nodes[commit.id];
      if (node) {
        node.active = index <= sliderVal;
      }
    });
  }, [sliderVal, sortedCommits]);

  // Main Canvas Rendering and Physics loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const resizeCanvas = () => {
      if (containerRef.current) {
        canvas.width = containerRef.current.clientWidth;
        canvas.height = containerRef.current.clientHeight;
      }
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Initial center adjustment once canvas size is resolved
    setTimeout(() => {
      const s = stateRef.current;
      s.pan.x = canvas.width / 2;
      s.pan.y = canvas.height - 180;
    }, 100);

    const runPhysicsAndRender = () => {
      const s = stateRef.current;
      const nodeKeys = Object.keys(s.nodes);
      const activeNodes = nodeKeys.map(k => s.nodes[k]);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      // ----------------------------------------------------
      // 1. UPDATE NODE TARGET COORD & TRANSITION ANIMATIONS
      // ----------------------------------------------------
      sortedCommits.forEach((commit, index) => {
        const node = s.nodes[commit.id];
        if (!node) return;

        // Vertical Yggdrasil Tree Layout: Grow upwards
        // Root commit (index 0) near base, growing upwards (subtracting index * 130)
        node.targetY = -index * 130 + 150;
        
        // Symmetrical branch lanes: main (lane 0) in center, features left, hotfixes right
        let xOffset = 0;
        if (node.lane > 0) {
          const direction = node.lane % 2 === 1 ? -1 : 1;
          const level = Math.ceil(node.lane / 2);
          xOffset = direction * level * 120;
        }
        node.targetX = xOffset;

        // Visual growth interpolation
        const targetScale = node.active ? 1.0 : 0.0;
        const targetOpacity = node.active ? 1.0 : 0.0;
        node.scale += (targetScale - node.scale) * 0.12;
        node.opacity += (targetOpacity - node.opacity) * 0.12;
      });

      // ----------------------------------------------------
      // 2. APPLY PHYSICS FORCES (Only for active nodes)
      // ----------------------------------------------------
      // A. Antigravity Repulsion (Exponential Mutual Repulsion)
      for (let i = 0; i < activeNodes.length; i++) {
        const nodeA = activeNodes[i];
        if (!nodeA.active) continue;

        for (let j = i + 1; j < activeNodes.length; j++) {
          const nodeB = activeNodes[j];
          if (!nodeB.active) continue;

          const dx = nodeA.x - nodeB.x;
          const dy = nodeA.y - nodeB.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1.0;

          if (dist < 300) {
            // F_repulsion = K_rep * exp(-dist / decayScale)
            const rawForce = K_REPULSION * Math.exp(-dist / DECAY_SCALE);
            const force = Math.min(rawForce, 15); // Clamp force to prevent explosions
            
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            nodeA.vx += fx;
            nodeA.vy += fy;
            nodeB.vx -= fx;
            nodeB.vy -= fy;
          }
        }
      }

      // B. Spring Forces (Hooke's Law along branch paths)
      activeNodes.forEach(node => {
        if (!node.active) return;

        node.commit.parentIds.forEach(parentId => {
          const parentNode = s.nodes[parentId];
          if (parentNode && parentNode.active) {
            const dx = node.x - parentNode.x;
            const dy = node.y - parentNode.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1.0;

            // F_spring = K_spring * (dist - restLength)
            const rawForce = K_SPRING * (dist - REST_LENGTH);
            const force = Math.max(-15, Math.min(15, rawForce)); // Clamp spring force
            
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            node.vx -= fx;
            node.vy -= fy;
            parentNode.vx += fx;
            parentNode.vy += fy;
          }
        });
      });

      // C. Target Pull & Direct Collapsing
      activeNodes.forEach(node => {
        if (!node.active) {
          // Inactive nodes collapse directly to parent's position via smooth geometric interpolation
          const parentId = node.commit.parentIds[0];
          const parentNode = parentId ? s.nodes[parentId] : null;
          
          if (parentNode) {
            node.x += (parentNode.x - node.x) * 0.18;
            node.y += (parentNode.y - node.y) * 0.18;
          } else {
            node.x += (0 - node.x) * 0.18;
            node.y += (0 - node.y) * 0.18;
          }
          // Reset velocity so it doesn't store kinetic energy when collapsing
          node.vx = 0;
          node.vy = 0;
        } else {
          // Active nodes steered towards their chronological layout coordinates
          node.vx += (node.targetX - node.x) * K_TARGET_X;
          node.vy += (node.targetY - node.y) * K_TARGET_Y;

          // Apply Damping (friction)
          node.vx *= DAMPING;
          node.vy *= DAMPING;

          // Cap velocity and settle micro-vibrations
          const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
          const maxSpeed = 8;
          if (speed > maxSpeed) {
            node.vx = (node.vx / speed) * maxSpeed;
            node.vy = (node.vy / speed) * maxSpeed;
          }
          if (speed < 0.08) {
            node.vx = 0;
            node.vy = 0;
          }

          // Lock dragged node to mouse
          if (s.draggedNodeId === node.id) {
            const worldMouseX = (s.mouse.x - s.pan.x) / s.zoom;
            const worldMouseY = (s.mouse.y - s.pan.y) / s.zoom;
            node.x = worldMouseX;
            node.y = worldMouseY;
            node.vx = 0;
            node.vy = 0;
          } else {
            node.x += node.vx;
            node.y += node.vy;
          }
        }
      });

      // ----------------------------------------------------
      // 3. CANVAS DRAW LOOP
      // ----------------------------------------------------
      // Clear with cinematic dark background
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Save canvas state and apply view transform (pan/zoom)
      ctx.save();
      ctx.translate(s.pan.x, s.pan.y);
      ctx.scale(s.zoom, s.zoom);

      // Draw subtle background grid
      const gridSize = 80;
      const leftBound = (-s.pan.x) / s.zoom;
      const topBound = (-s.pan.y) / s.zoom;
      const rightBound = (canvas.width - s.pan.x) / s.zoom;
      const bottomBound = (canvas.height - s.pan.y) / s.zoom;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.lineWidth = 1 / s.zoom;
      
      const startGridX = Math.floor(leftBound / gridSize) * gridSize;
      const endGridX = Math.ceil(rightBound / gridSize) * gridSize;
      const startGridY = Math.floor(topBound / gridSize) * gridSize;
      const endGridY = Math.ceil(bottomBound / gridSize) * gridSize;

      for (let x = startGridX; x <= endGridX; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, topBound);
        ctx.lineTo(x, bottomBound);
        ctx.stroke();
      }
      for (let y = startGridY; y <= endGridY; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(leftBound, y);
        ctx.lineTo(rightBound, y);
        ctx.stroke();
      }

      // DRAW ORGANIC TRUNK (Under the root node)
      const rootCommit = sortedCommits[0];
      const rootNode = rootCommit ? s.nodes[rootCommit.id] : null;
      if (rootNode && rootNode.opacity > 0.05) {
        ctx.save();
        ctx.globalAlpha = rootNode.opacity * 0.22;

        const trunkGrad = ctx.createLinearGradient(0, rootNode.y + 180, 0, rootNode.y);
        trunkGrad.addColorStop(0, 'rgba(30, 41, 59, 0.0)');
        trunkGrad.addColorStop(0.3, 'rgba(47, 54, 71, 0.3)');
        trunkGrad.addColorStop(0.7, 'rgba(74, 85, 104, 0.5)');
        trunkGrad.addColorStop(1, rootNode.color);

        ctx.fillStyle = trunkGrad;
        ctx.beginPath();
        ctx.moveTo(rootNode.x - 24, rootNode.y + 180);
        ctx.bezierCurveTo(
          rootNode.x - 12, rootNode.y + 100,
          rootNode.x - 8, rootNode.y + 40,
          rootNode.x, rootNode.y
        );
        ctx.bezierCurveTo(
          rootNode.x + 8, rootNode.y + 40,
          rootNode.x + 12, rootNode.y + 100,
          rootNode.x + 24, rootNode.y + 180
        );
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // DRAW EDGES (Tapered organic tree limbs connecting parents and children)
      activeNodes.forEach(node => {
        if (node.opacity < 0.05) return;

        node.commit.parentIds.forEach(parentId => {
          const parentNode = s.nodes[parentId];
          if (parentNode && parentNode.opacity >= 0.05) {
            const opacity = Math.min(node.opacity, parentNode.opacity) * 0.4;
            
            ctx.beginPath();
            ctx.moveTo(parentNode.x, parentNode.y);

            // Compute midpoint and Bezier control points for vertical organic flow
            const midY = (parentNode.y + node.y) / 2;
            ctx.bezierCurveTo(
              parentNode.x, midY,
              node.x, midY,
              node.x, node.y
            );

            // Taper thickness: base of tree is thicker, twigs higher up are thinner
            const parentIdx = sortedCommits.findIndex(c => c.id === parentNode.commit.id);
            const branchWidth = Math.max(7.5 - parentIdx * 0.45, 2.5);
            ctx.lineWidth = branchWidth;

            // Create gradient line between parents and children
            const grad = ctx.createLinearGradient(parentNode.x, parentNode.y, node.x, node.y);
            grad.addColorStop(0, parentNode.color);
            grad.addColorStop(1, node.color);

            ctx.strokeStyle = grad;
            ctx.globalAlpha = opacity;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
          }
        });
      });

      // DRAW NODES
      activeNodes.forEach(node => {
        if (node.opacity < 0.05) return;

        ctx.save();
        ctx.globalAlpha = node.opacity;

        const size = 15 * node.scale;
        
        // Neon Glow effect on canvas
        ctx.shadowBlur = 18 * node.scale;
        ctx.shadowColor = node.color;

        // Outer glow path
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
        ctx.fillStyle = node.color;
        ctx.fill();

        // Inner core
        ctx.shadowBlur = 0; // Turn off shadow to draw crisp inner details
        ctx.beginPath();
        ctx.arc(node.x, node.y, size * 0.55, 0, 2 * Math.PI);
        ctx.fillStyle = '#05070c';
        ctx.fill();

        // Add a small center point
        ctx.beginPath();
        ctx.arc(node.x, node.y, size * 0.25, 0, 2 * Math.PI);
        ctx.fillStyle = node.color;
        ctx.fill();

        // If hovered, render selection ring
        const isHovered = hoveredNode && hoveredNode.id === node.id;
        if (isHovered) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(node.x, node.y, size + 6, 0, 2 * Math.PI);
          ctx.stroke();
        }

        // DRAW ORGANIC LEAVES (depicting files changed in this commit)
        const details = node.commit.details || [];
        const leafCount = Math.min(details.length, 6);
        
        for (let j = 0; j < leafCount; j++) {
          const file = details[j];
          // Fan out leaves upwards/outwards: -90 degrees center angle, spread by 0.45 rad
          const angle = -Math.PI / 2 + (j - (leafCount - 1) / 2) * 0.45;
          const leafScale = node.scale;
          
          const leafBaseX = node.x + Math.cos(angle) * (size + 3 * leafScale);
          const leafBaseY = node.y + Math.sin(angle) * (size + 3 * leafScale);
          const leafTipX = node.x + Math.cos(angle) * (size + 20 * leafScale);
          const leafTipY = node.y + Math.sin(angle) * (size + 20 * leafScale);

          // Control points for organic quadratic curves to form leaf blade
          const leftAngle = angle - 0.28;
          const rightAngle = angle + 0.28;
          const ctrlDist = size + 11 * leafScale;
          const ctrlLeftX = node.x + Math.cos(leftAngle) * ctrlDist;
          const ctrlLeftY = node.y + Math.sin(leftAngle) * ctrlDist;
          const ctrlRightX = node.x + Math.cos(rightAngle) * ctrlDist;
          const ctrlRightY = node.y + Math.sin(rightAngle) * ctrlDist;

          // Green for additions, Amber for modifications, Red for deletions
          let leafColor = '#10b981'; // green
          if (file.status.startsWith('M')) {
            leafColor = '#f59e0b'; // amber
          } else if (file.status.startsWith('D')) {
            leafColor = '#ef4444'; // red
          }

          // Draw stem twig
          ctx.beginPath();
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(leafBaseX, leafBaseY);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.lineWidth = 1 * leafScale;
          ctx.stroke();

          // Draw leaf shape body
          ctx.beginPath();
          ctx.moveTo(leafBaseX, leafBaseY);
          ctx.quadraticCurveTo(ctrlLeftX, ctrlLeftY, leafTipX, leafTipY);
          ctx.quadraticCurveTo(ctrlRightX, ctrlRightY, leafBaseX, leafBaseY);
          ctx.fillStyle = leafColor;
          ctx.fill();

          // Draw central vein details
          ctx.beginPath();
          ctx.moveTo(leafBaseX, leafBaseY);
          ctx.lineTo(leafTipX, leafTipY);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.lineWidth = 0.8 * leafScale;
          ctx.stroke();

          // Highlight hovered leaf
          const isLeafHovered = hoveredLeaf && 
                               hoveredLeaf.file.path === file.path && 
                               hoveredLeaf.commitId === node.commit.id;
          if (isLeafHovered) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(leafTipX - Math.cos(angle)*6, leafTipY - Math.sin(angle)*6, 8 * leafScale, 0, 2 * Math.PI);
            ctx.stroke();
          }
        }

        ctx.restore();
      });

      ctx.restore();

      // ----------------------------------------------------
      // 4. MOUSE HOVER DETECTION (Calculated in UI space)
      // ----------------------------------------------------
      let nextHoveredNode = null;
      let nextHoveredLeaf = null;
      const worldMouseX = (s.mouse.x - s.pan.x) / s.zoom;
      const worldMouseY = (s.mouse.y - s.pan.y) / s.zoom;

      for (let i = 0; i < activeNodes.length; i++) {
        const node = activeNodes[i];
        if (node.opacity < 0.1) continue;

        const size = 15 * node.scale;

        // Check if mouse is hovering over the node core
        const dx = node.x - worldMouseX;
        const dy = node.y - worldMouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= size + 5) {
          nextHoveredNode = node;
          break;
        }

        // Check if mouse is hovering over any leaf of this node
        const details = node.commit.details || [];
        const count = Math.min(details.length, 6);
        for (let j = 0; j < count; j++) {
          const file = details[j];
          const angle = -Math.PI / 2 + (j - (count - 1) / 2) * 0.45;
          const leafScale = node.scale;
          const leafDist = size + 16 * leafScale; // Center of leaf
          const leafX = node.x + Math.cos(angle) * leafDist;
          const leafY = node.y + Math.sin(angle) * leafDist;

          const ldx = leafX - worldMouseX;
          const ldy = leafY - worldMouseY;
          const ldist = Math.sqrt(ldx * ldx + ldy * ldy);

          if (ldist <= 12) {
            nextHoveredLeaf = {
              file,
              commitId: node.commit.id,
              commitMessage: node.commit.message,
              author: node.commit.author,
              color: node.color
            };
            break;
          }
        }
        if (nextHoveredLeaf) break;
      }

      if (nextHoveredNode) {
        if (!hoveredNode || hoveredNode.id !== nextHoveredNode.id) {
          setHoveredNode(nextHoveredNode.commit);
          setHoveredLeaf(null);
          // Set HUD position offset from the screen mouse location
          setHudPos({
            x: s.mouse.x + 20,
            y: s.mouse.y - 40
          });
        }
      } else if (nextHoveredLeaf) {
        if (!hoveredLeaf || hoveredLeaf.file.path !== nextHoveredLeaf.file.path || hoveredLeaf.commitId !== nextHoveredLeaf.commitId) {
          setHoveredNode(null);
          setHoveredLeaf(nextHoveredLeaf);
          setHudPos({
            x: s.mouse.x + 20,
            y: s.mouse.y - 40
          });
        }
      } else {
        if (hoveredNode) setHoveredNode(null);
        if (hoveredLeaf) setHoveredLeaf(null);
      }

      animationFrameId = requestAnimationFrame(runPhysicsAndRender);
    };

    runPhysicsAndRender();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [sortedCommits, hoveredNode]);

  // Mouse drag-to-pan & zoom event handlers
  const handleMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const s = stateRef.current;
    s.mouse = { x, y };

    // Check if we clicked on a node to drag it
    let clickedNodeId = null;
    const worldMouseX = (x - s.pan.x) / s.zoom;
    const worldMouseY = (y - s.pan.y) / s.zoom;

    const nodesArray = Object.values(s.nodes);
    for (const node of nodesArray) {
      if (node.opacity < 0.1) continue;
      const dx = node.x - worldMouseX;
      const dy = node.y - worldMouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= 22) {
        clickedNodeId = node.id;
        break;
      }
    }

    if (clickedNodeId) {
      s.draggedNodeId = clickedNodeId;
    } else {
      s.isDraggingCanvas = true;
      s.dragStart = { x: e.clientX - s.pan.x, y: e.clientY - s.pan.y };
    }
  };

  const handleMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const s = stateRef.current;
    s.mouse = { x, y };

    if (s.isDraggingCanvas) {
      s.pan.x = e.clientX - s.dragStart.x;
      s.pan.y = e.clientY - s.dragStart.y;
    }

    if (hoveredNode) {
      // Smoothly update HUD position along with cursor
      setHudPos({ x: x + 20, y: y - 40 });
    }
  };

  const handleMouseUp = () => {
    const s = stateRef.current;
    s.isDraggingCanvas = false;
    s.draggedNodeId = null;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const s = stateRef.current;
    const zoomIntensity = 0.1;
    const wheelVal = e.deltaY < 0 ? 1 : -1;
    const zoomFactor = Math.exp(wheelVal * zoomIntensity);

    // Zoom around mouse pointer
    const newZoom = Math.min(Math.max(s.zoom * zoomFactor, 0.25), 4.0);
    
    s.pan.x = mouseX - (mouseX - s.pan.x) * (newZoom / s.zoom);
    s.pan.y = mouseY - (mouseY - s.pan.y) * (newZoom / s.zoom);
    s.zoom = newZoom;
  };

  const handleResetView = () => {
    const s = stateRef.current;
    s.zoom = 1.0;
    s.pan = {
      x: canvasRef.current.width / 2,
      y: canvasRef.current.height - 180
    };
  };

  return (
    <div 
      className="rewind-visualization-container" 
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#0b0f19',
        userSelect: 'none'
      }}
    >
      {/* Simulation canvas context */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: stateRef.current.isDraggingCanvas ? 'grabbing' : 'grab'
        }}
      />

      {/* Reset view overlay control */}
      <button 
        className="canvas-reset-btn"
        onClick={handleResetView}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          background: 'rgba(30, 41, 59, 0.75)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '9999px',
          color: '#ffffff',
          padding: '8px 16px',
          fontFamily: 'inherit',
          fontWeight: '600',
          fontSize: '12px',
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          transition: 'all 0.2s',
          zIndex: 10
        }}
      >
        Reset Camera
      </button>

      {/* Floating neon HUD details overlay */}
      {hoveredNode && (
        <div
          className="floating-hud-overlay"
          style={{
            position: 'absolute',
            left: `${hudPos.x}px`,
            top: `${hudPos.y}px`,
            transform: 'translateY(-100%)',
            background: 'rgba(11, 15, 25, 0.94)',
            border: `1px solid ${commitLayouts[hoveredNode.id]?.color || 'rgba(255, 255, 255, 0.2)'}`,
            boxShadow: `0 8px 32px rgba(0, 0, 0, 0.5), 0 0 15px ${(commitLayouts[hoveredNode.id]?.color || '#ffffff')}44`,
            borderRadius: '12px',
            padding: '16px',
            color: '#f3f4f6',
            width: '280px',
            fontFamily: 'ui-monospace, Consolas, monospace',
            fontSize: '12.5px',
            pointerEvents: 'none',
            zIndex: 100,
            backdropFilter: 'blur(12px)',
            transition: 'all 0.2s'
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '6px' }}>
            <span style={{ color: commitLayouts[hoveredNode.id]?.color, fontWeight: 'bold' }}>
              {hoveredNode.id.substring(0, 7)}
            </span>
            <span style={{ opacity: 0.6 }}>
              {new Date(hoveredNode.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Author & Commit message */}
          <div style={{ marginBottom: '8px' }}>
            <div style={{ color: '#fff', fontSize: '13px', fontWeight: '500', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {hoveredNode.message}
            </div>
            <div style={{ opacity: 0.7 }}>
              Author: <span style={{ color: '#fff' }}>{hoveredNode.author}</span>
            </div>
          </div>

          {/* File change statistics */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '10px', fontSize: '11.5px' }}>
            <span style={{ color: '#00f2fe', fontWeight: '600' }}>
              Files: {hoveredNode.details?.length || 0}
            </span>
            <span style={{ color: '#10b981', fontWeight: '600' }}>
              +{hoveredNode.additions}
            </span>
            <span style={{ color: '#ef4444', fontWeight: '600' }}>
              -{hoveredNode.deletions}
            </span>
            <span style={{ color: '#a855f7', fontWeight: '600' }}>
              *{hoveredNode.modifications}
            </span>
          </div>

          {/* Detailed file logs */}
          {hoveredNode.details && hoveredNode.details.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', maxHeight: '100px', overflowY: 'auto' }}>
              {hoveredNode.details.slice(0, 4).map((file, idx) => {
                let statusColor = '#fff';
                if (file.status.startsWith('A')) statusColor = '#10b981';
                else if (file.status.startsWith('D')) statusColor = '#ef4444';
                else if (file.status.startsWith('M')) statusColor = '#3b82f6';

                return (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', opacity: 0.85, fontSize: '11px' }}>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '220px', color: '#9ca3af' }}>
                      {file.path}
                    </span>
                    <span style={{ color: statusColor, fontWeight: 'bold' }}>
                      [{file.status}]
                    </span>
                  </div>
                );
              })}
              {hoveredNode.details.length > 4 && (
                <div style={{ opacity: 0.5, fontSize: '9px', textAlign: 'center', marginTop: '4px', color: '#6b7280' }}>
                  + {hoveredNode.details.length - 4} more files
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* Floating leaf HUD details overlay */}
      {hoveredLeaf && (
        <div
          className="floating-hud-overlay leaf-hud-overlay"
          style={{
            position: 'absolute',
            left: `${hudPos.x}px`,
            top: `${hudPos.y}px`,
            transform: 'translateY(-100%)',
            background: 'rgba(11, 15, 25, 0.94)',
            border: `1px solid ${hoveredLeaf.color || 'rgba(255, 255, 255, 0.2)'}`,
            boxShadow: `0 8px 32px rgba(0, 0, 0, 0.5), 0 0 15px ${(hoveredLeaf.color || '#ffffff')}44`,
            borderRadius: '12px',
            padding: '12px 16px',
            color: '#f3f4f6',
            width: '280px',
            fontFamily: 'ui-monospace, Consolas, monospace',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 100,
            backdropFilter: 'blur(12px)',
            transition: 'all 0.15s'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '4px' }}>
            <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Leaf (File Change)
            </span>
            <span style={{ opacity: 0.6, fontSize: '10px' }}>
              in {hoveredLeaf.commitId.substring(0, 7)}
            </span>
          </div>

          <div style={{ wordBreak: 'break-all', fontWeight: 'bold', color: '#fff', fontSize: '12.5px', marginBottom: '6px' }}>
            {hoveredLeaf.file.path}
          </div>

          <div style={{ display: 'flex', gap: '8px', fontSize: '11px', marginBottom: '6px' }}>
            <span>Status:</span>
            <span style={{ 
              color: hoveredLeaf.file.status.startsWith('A') ? '#10b981' : hoveredLeaf.file.status.startsWith('D') ? '#ef4444' : '#f59e0b',
              fontWeight: 'bold' 
            }}>
              {hoveredLeaf.file.status.startsWith('A') ? 'ADDED' : hoveredLeaf.file.status.startsWith('D') ? 'DELETED' : 'MODIFIED'}
            </span>
          </div>

          <div style={{ fontSize: '10px', opacity: 0.7, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '4px' }}>
            <div>Commit: "{hoveredLeaf.commitMessage}"</div>
            <div style={{ marginTop: '2px' }}>by {hoveredLeaf.author}</div>
          </div>
        </div>
      )}

      {/* Control timeline dock at the bottom */}
      <div 
        className="time-travel-dock"
        style={{
          position: 'absolute',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '85%',
          maxWidth: '800px',
          background: 'rgba(11, 15, 25, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255,255,255,0.05)',
          borderRadius: '24px', // Spaced nicely for timeline nodes
          padding: '16px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 10,
          backdropFilter: 'blur(16px)'
        }}
      >
        <CommitTimeline 
          commits={sortedCommits} 
          sliderVal={sliderVal} 
          setSliderVal={setSliderVal} 
        />
      </div>
    </div>
  );
}
