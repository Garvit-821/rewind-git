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
      // Clear with deep misty forest gradient
      const bgGrad = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 30,
        canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height)
      );
      bgGrad.addColorStop(0, '#030f05');
      bgGrad.addColorStop(0.6, '#010802');
      bgGrad.addColorStop(1, '#000300');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Save canvas state and apply view transform (pan/zoom)
      ctx.save();
      ctx.translate(s.pan.x, s.pan.y);
      ctx.scale(s.zoom, s.zoom);

      // ---- HELPER: draw a fractal sub-branch off a point ----
      const drawFractalTwig = (sx, sy, angle, len, depth) => {
        if (depth <= 0 || len < 2) return;
        const ex = sx + Math.cos(angle) * len;
        const ey = sy + Math.sin(angle) * len;

        // Glow bloom
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
        ctx.strokeStyle = `rgba(57,255,20,${0.08 + depth * 0.04})`;
        ctx.lineWidth = depth * 1.8;
        ctx.shadowBlur = 6 + depth * 4;
        ctx.shadowColor = '#39ff14';
        ctx.stroke();

        // Core white-green line
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
        ctx.strokeStyle = depth >= 2 ? '#c8ffc8' : '#80ff80';
        ctx.lineWidth = Math.max(0.5, depth * 0.7);
        ctx.shadowBlur = 0;
        ctx.stroke();

        // Leaf dot at tip
        ctx.beginPath();
        ctx.arc(ex, ey, Math.max(1, depth * 1.2), 0, 2 * Math.PI);
        ctx.fillStyle = depth >= 2 ? 'rgba(200,255,180,0.9)' : 'rgba(120,255,120,0.7)';
        ctx.shadowBlur = 6; ctx.shadowColor = '#39ff14';
        ctx.fill();
        ctx.shadowBlur = 0;

        // Recurse two child sub-branches
        const spread = 0.4 + (3 - depth) * 0.15;
        drawFractalTwig(ex, ey, angle - spread, len * 0.65, depth - 1);
        drawFractalTwig(ex, ey, angle + spread, len * 0.65, depth - 1);
      };

      // ---- HELPER: draw a full glowing vine between two world points ----
      const drawGlowingVine = (x1, y1, x2, y2, thickness, parentIdx) => {
        const midY = (y1 + y2) / 2;
        // Three-pass: bloom -> main green -> white core
        const passes = [
          { color: 'rgba(57,255,20,0.12)', w: thickness * 4.5, blur: 22, shadow: '#39ff14' },
          { color: 'rgba(34,197,94,0.85)', w: thickness, blur: 10, shadow: '#22c55e' },
          { color: '#e8ffe8', w: Math.max(0.8, thickness * 0.22), blur: 4, shadow: '#ffffff' },
        ];
        passes.forEach(p => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.bezierCurveTo(x1, midY, x2, midY, x2, y2);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.w;
          ctx.shadowBlur = p.blur;
          ctx.shadowColor = p.shadow;
          ctx.stroke();
        });
        ctx.shadowBlur = 0;

        // Sample points along the bezier and sprout fractal sub-branches
        const steps = 9;
        for (let k = 1; k < steps; k++) {
          const t = k / steps;
          const mt = 1 - t;
          // Cubic bezier with control points (x1,midY) and (x2,midY)
          const bx = mt * mt * mt * x1 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x2;
          const by = mt * mt * mt * y1 + 3 * mt * mt * t * midY + 3 * mt * t * t * midY + t * t * t * y2;

          // Tangent direction perpendicular to the branch
          const tanX = -3 * mt * mt * x1 + 3 * (mt * mt - 2 * mt * t) * x1 + 3 * (2 * mt * t - t * t) * x2 + 3 * t * t * x2;
          const tanY = -3 * mt * mt * y1 + 3 * (mt * mt - 2 * mt * t) * midY + 3 * (2 * mt * t - t * t) * midY + 3 * t * t * y2;
          const tanLen = Math.sqrt(tanX * tanX + tanY * tanY) || 1;
          const perpAngle = Math.atan2(tanX / tanLen, -(tanY / tanLen)); // 90° CCW

          // Alternate sides: even k → left, odd k → right, plus tiny off-axis variation
          const side = k % 2 === 0 ? 1 : -1;
          const twigAngle = perpAngle * side + (Math.sin(k * 2.7 + x1) * 0.18);
          const twigLen = (14 + Math.sin(k * 1.9 + y1) * 8) * (1 - parentIdx * 0.06);

          drawFractalTwig(bx, by, twigAngle, Math.max(6, twigLen), 2);
        }
      };

      // ---- DRAW TRUNK (root node base) ----
      const rootCommit = sortedCommits[0];
      const rootNode = rootCommit ? s.nodes[rootCommit.id] : null;
      if (rootNode && rootNode.opacity > 0.05) {
        const tx = rootNode.x, ty = rootNode.y;
        const trunkBot = ty + 160;

        // Thick bloom
        ctx.beginPath();
        ctx.moveTo(tx, trunkBot); ctx.lineTo(tx, ty);
        ctx.strokeStyle = 'rgba(57,255,20,0.18)';
        ctx.lineWidth = 36; ctx.shadowBlur = 30; ctx.shadowColor = '#39ff14';
        ctx.stroke();

        // Main green bark
        ctx.beginPath();
        ctx.moveTo(tx, trunkBot); ctx.lineTo(tx, ty);
        ctx.strokeStyle = 'rgba(34,197,94,0.9)';
        ctx.lineWidth = 14; ctx.shadowBlur = 14; ctx.shadowColor = '#22c55e';
        ctx.stroke();

        // White electric core
        ctx.beginPath();
        ctx.moveTo(tx, trunkBot); ctx.lineTo(tx, ty);
        ctx.strokeStyle = '#f0fff0';
        ctx.lineWidth = 3.5; ctx.shadowBlur = 6; ctx.shadowColor = '#ffffff';
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Root ground glow
        const rGrad = ctx.createRadialGradient(tx, trunkBot, 0, tx, trunkBot, 50);
        rGrad.addColorStop(0, 'rgba(57,255,20,0.22)');
        rGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rGrad;
        ctx.fillRect(tx - 50, trunkBot - 10, 100, 60);
      }

      // ---- DRAW EDGES as glowing fractal vines ----
      activeNodes.forEach(node => {
        if (node.opacity < 0.05) return;
        ctx.globalAlpha = node.opacity;
        node.commit.parentIds.forEach(parentId => {
          const pn = s.nodes[parentId];
          if (pn && pn.opacity >= 0.05) {
            const parentIdx = sortedCommits.findIndex(c => c.id === pn.commit.id);
            const baseThickness = Math.max(2.5, 8 - parentIdx * 0.5);
            drawGlowingVine(pn.x, pn.y, node.x, node.y, baseThickness, parentIdx);
          }
        });
        ctx.globalAlpha = 1.0;
      });

      // ---- DRAW NODE KNOTS ----
      activeNodes.forEach(node => {
        if (node.opacity < 0.05) return;
        ctx.save();
        ctx.globalAlpha = node.opacity;

        const size = 9 * node.scale;

        // Bloom ring
        ctx.beginPath();
        ctx.arc(node.x, node.y, size * 2.2, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(57,255,20,0.12)';
        ctx.shadowBlur = 16; ctx.shadowColor = '#39ff14';
        ctx.fill();

        // Green knot body
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
        ctx.fillStyle = '#22c55e';
        ctx.shadowBlur = 10; ctx.shadowColor = '#39ff14';
        ctx.fill();

        // White hot core
        ctx.beginPath();
        ctx.arc(node.x, node.y, size * 0.4, 0, 2 * Math.PI);
        ctx.fillStyle = '#f0fff0';
        ctx.shadowBlur = 6; ctx.shadowColor = '#fff';
        ctx.fill();
        ctx.shadowBlur = 0;

        // Hovered ring
        if (hoveredNode && hoveredNode.id === node.commit.id) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, size + 7, 0, 2 * Math.PI);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // File change leaves sprouting from top
        const details = node.commit.details || [];
        const leafCount = Math.min(details.length, 6);
        for (let j = 0; j < leafCount; j++) {
          const file = details[j];
          const angle = -Math.PI / 2 + (j - (leafCount - 1) / 2) * 0.42;
          const sc = node.scale;
          const bx = node.x + Math.cos(angle) * (size + 2);
          const by = node.y + Math.sin(angle) * (size + 2);
          const tx2 = node.x + Math.cos(angle) * (size + 22 * sc);
          const ty2 = node.y + Math.sin(angle) * (size + 22 * sc);
          const la = angle - 0.3, ra = angle + 0.3;
          const cd = size + 12 * sc;
          const clx = node.x + Math.cos(la) * cd, cly = node.y + Math.sin(la) * cd;
          const crx = node.x + Math.cos(ra) * cd, cry = node.y + Math.sin(ra) * cd;

          let lc = '#4ade80';
          if (file.status.startsWith('M')) lc = '#fbbf24';
          else if (file.status.startsWith('D')) lc = '#f87171';

          // Stem
          ctx.beginPath(); ctx.moveTo(node.x, node.y); ctx.lineTo(bx, by);
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.2 * sc;
          ctx.shadowBlur = 4; ctx.shadowColor = lc; ctx.stroke();

          // Leaf blade
          ctx.beginPath(); ctx.moveTo(bx, by);
          ctx.quadraticCurveTo(clx, cly, tx2, ty2);
          ctx.quadraticCurveTo(crx, cry, bx, by);
          ctx.fillStyle = lc; ctx.shadowBlur = 8; ctx.shadowColor = lc; ctx.fill();

          // Center vein
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx2, ty2);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.9 * sc; ctx.shadowBlur = 3; ctx.stroke();
          ctx.shadowBlur = 0;

          // Hovered leaf ring
          const isLeafHovered = hoveredLeaf && hoveredLeaf.file.path === file.path && hoveredLeaf.commitId === node.commit.id;
          if (isLeafHovered) {
            ctx.beginPath();
            ctx.arc(tx2 - Math.cos(angle) * 5, ty2 - Math.sin(angle) * 5, 8 * sc, 0, 2 * Math.PI);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
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

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  useEffect(() => {
    if (isRecording && sliderVal === sortedCommits.length - 1) {
      const timer = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          setIsRecording(false);
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [sliderVal, isRecording, sortedCommits.length]);

  const handleExportSVG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const nodeKeys = Object.keys(s.nodes);
    const activeNodes = nodeKeys.map(k => s.nodes[k]).filter(n => n.opacity >= 0.05);

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}">
      <defs>
        <radialGradient id="bg-grad" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stop-color="#030f05" />
          <stop offset="60%" stop-color="#010802" />
          <stop offset="100%" stop-color="#000300" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg-grad)" />
      <g transform="translate(${s.pan.x}, ${s.pan.y}) scale(${s.zoom})">
    `;

    // Add Trunk
    const rootCommit = sortedCommits[0];
    const rootNode = rootCommit ? s.nodes[rootCommit.id] : null;
    if (rootNode) {
      const tx = rootNode.x, ty = rootNode.y;
      const trunkBot = ty + 160;
      svgContent += `
        <!-- Trunk -->
        <path d="M ${tx - 36} ${trunkBot} L ${tx + 36} ${trunkBot} L ${tx} ${ty} Z" fill="rgba(34, 197, 94, 0.15)" />
        <path d="M ${tx - 14} ${trunkBot} L ${tx + 14} ${trunkBot} L ${tx} ${ty} Z" fill="rgba(34, 197, 94, 0.7)" />
        <line x1="${tx}" y1="${trunkBot}" x2="${tx}" y2="${ty}" stroke="#f0fdf4" stroke-width="3.5" />
      `;
    }

    // Add Branches / Vines
    activeNodes.forEach(node => {
      node.commit.parentIds.forEach(parentId => {
        const pn = s.nodes[parentId];
        if (pn && pn.opacity >= 0.05) {
          const parentIdx = sortedCommits.findIndex(c => c.id === pn.commit.id);
          const thickness = Math.max(2.5, 8 - parentIdx * 0.5);
          const x1 = pn.x, y1 = pn.y, x2 = node.x, y2 = node.y;
          const midY = (y1 + y2) / 2;

          svgContent += `
            <!-- Vine -->
            <path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="rgba(57,255,20,0.12)" stroke-width="${thickness * 4.5}" stroke-linecap="round" />
            <path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="rgba(34,197,94,0.85)" stroke-width="${thickness}" stroke-linecap="round" />
            <path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="#e8ffe8" stroke-width="${Math.max(0.8, thickness * 0.22)}" stroke-linecap="round" />
          `;

          // Twigs along path
          const steps = 9;
          for (let k = 1; k < steps; k++) {
            const t = k / steps;
            const mt = 1 - t;
            const bx = mt * mt * mt * x1 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x2;
            const by = mt * mt * mt * y1 + 3 * mt * mt * t * midY + 3 * mt * t * t * midY + t * t * t * y2;

            const tanX = -3 * mt * mt * x1 + 3 * (mt * mt - 2 * mt * t) * x1 + 3 * (2 * mt * t - t * t) * x2 + 3 * t * t * x2;
            const tanY = -3 * mt * mt * y1 + 3 * (mt * mt - 2 * mt * t) * midY + 3 * (2 * mt * t - t * t) * midY + 3 * t * t * y2;
            const tanLen = Math.sqrt(tanX * tanX + tanY * tanY) || 1;
            const perpAngle = Math.atan2(tanX / tanLen, -(tanY / tanLen));

            const side = k % 2 === 0 ? 1 : -1;
            const twigAngle = perpAngle * side + (Math.sin(k * 2.7 + x1) * 0.18);
            const twigLen = (14 + Math.sin(k * 1.9 + y1) * 8) * (1 - parentIdx * 0.06);

            const addTwig = (sx, sy, angle, len, depth) => {
              if (depth <= 0 || len < 2) return;
              const ex = sx + Math.cos(angle) * len;
              const ey = sy + Math.sin(angle) * len;
              svgContent += `
                <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="rgba(57,255,20,${0.08 + depth * 0.04})" stroke-width="${depth * 1.8}" stroke-linecap="round" />
                <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${depth >= 2 ? '#c8ffc8' : '#80ff80'}" stroke-width="${Math.max(0.5, depth * 0.7)}" stroke-linecap="round" />
                <circle cx="${ex}" cy="${ey}" r="${Math.max(1, depth * 1.2)}" fill="${depth >= 2 ? 'rgba(200,255,180,0.9)' : 'rgba(120,255,120,0.7)'}" />
              `;
              const spread = 0.45;
              addTwig(ex, ey, angle - spread, len * 0.65, depth - 1);
              addTwig(ex, ey, angle + spread, len * 0.65, depth - 1);
            };
            addTwig(bx, by, twigAngle, Math.max(6, twigLen), 2);
          }
        }
      });
    });

    // Add Nodes
    activeNodes.forEach(node => {
      const size = 9 * node.scale;
      svgContent += `
        <!-- Node -->
        <circle cx="${node.x}" cy="${node.y}" r="${size * 2.2}" fill="rgba(57,255,20,0.12)" />
        <circle cx="${node.x}" cy="${node.y}" r="${size}" fill="#22c55e" />
        <circle cx="${node.x}" cy="${node.y}" r="${size * 0.4}" fill="#f0fff0" />
      `;

      // Leaves
      const details = node.commit.details || [];
      const leafCount = Math.min(details.length, 6);
      for (let j = 0; j < leafCount; j++) {
        const file = details[j];
        const angle = -Math.PI / 2 + (j - (leafCount - 1) / 2) * 0.42;
        const sc = node.scale;
        const bx = node.x + Math.cos(angle) * (size + 2);
        const by = node.y + Math.sin(angle) * (size + 2);
        const tx2 = node.x + Math.cos(angle) * (size + 22 * sc);
        const ty2 = node.y + Math.sin(angle) * (size + 22 * sc);
        const la = angle - 0.3, ra = angle + 0.3;
        const cd = size + 12 * sc;
        const clx = node.x + Math.cos(la) * cd, cly = node.y + Math.sin(la) * cd;
        const crx = node.x + Math.cos(ra) * cd, cry = node.y + Math.sin(ra) * cd;

        let lc = '#4ade80';
        if (file.status.startsWith('M')) lc = '#fbbf24';
        else if (file.status.startsWith('D')) lc = '#f87171';

        svgContent += `
          <!-- Leaf -->
          <line x1="${node.x}" y1="${node.y}" x2="${bx}" y2="${by}" stroke="rgba(255,255,255,0.5)" stroke-width="${1.2 * sc}" stroke-linecap="round" />
          <path d="M ${bx} ${by} Q ${clx} ${cly}, ${tx2} ${ty2} Q ${crx} ${cry}, ${bx} ${by}" fill="${lc}" />
          <line x1="${bx}" y1="${by}" x2="${tx2}" y2="${ty2}" stroke="#ffffff" stroke-width="${0.9 * sc}" stroke-linecap="round" />
        `;
      }
    });

    svgContent += `
      </g>
    </svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `yggdrasil-tree-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleToggleRecord = () => {
    if (isRecording) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
    } else {
      const canvas = canvasRef.current;
      if (!canvas) return;

      recordedChunksRef.current = [];
      setSliderVal(0);

      const stream = canvas.captureStream(30);
      let options = { mimeType: 'video/webm;codecs=vp9' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm;codecs=vp8' };
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' };
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = {};
      }

      try {
        const mediaRecorder = new MediaRecorder(stream, options);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `rewind-timelapse-${Date.now()}.webm`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        };

        mediaRecorder.start();
        setIsRecording(true);
      } catch (err) {
        console.error('Failed to start MediaRecorder:', err);
        alert('Browser does not support canvas video recording.');
      }
    }
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

      {/* View overlays and export controls */}
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 10
      }}>
        <button
          className="canvas-reset-btn"
          onClick={handleResetView}
          style={{
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
            width: '150px',
            textAlign: 'center'
          }}
        >
          Reset Camera
        </button>

        <button
          className="canvas-export-btn"
          onClick={handleExportSVG}
          style={{
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.4)',
            borderRadius: '9999px',
            color: '#4ade80',
            padding: '8px 16px',
            fontFamily: 'inherit',
            fontWeight: '600',
            fontSize: '12px',
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s',
            width: '150px',
            textAlign: 'center'
          }}
        >
          📤 Export SVG
        </button>

        <button
          className={`canvas-record-btn ${isRecording ? 'recording' : ''}`}
          onClick={handleToggleRecord}
          style={{
            background: isRecording ? 'rgba(239, 68, 68, 0.25)' : 'rgba(168, 85, 247, 0.15)',
            border: isRecording ? '1px solid #ef4444' : '1px solid rgba(168, 85, 247, 0.4)',
            borderRadius: '9999px',
            color: isRecording ? '#f87171' : '#c084fc',
            padding: '8px 16px',
            fontFamily: 'inherit',
            fontWeight: '600',
            fontSize: '12px',
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            width: '150px'
          }}
        >
          {isRecording ? (
            <>
              <span style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                background: '#ef4444',
                borderRadius: '50%',
                animation: 'pulse 1s infinite'
              }}></span>
              Stop Rec
            </>
          ) : (
            '📹 Record Lapse'
          )}
        </button>
      </div>

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


// /* commit-fix */