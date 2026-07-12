import React, { useEffect, useRef, useState, useMemo } from 'react';

// Neon colors assigned to branches
const BRANCH_COLORS = {
  main: '#00f2fe',    // Neon Cyan
  feature: '#d946ef', // Neon Purple/Magenta
  hotfix: '#f59e0b',  // Neon Amber
};

// Physics constants
const K_REPULSION = 0;       // Disabled to maintain exact symmetrical layout structure
const DECAY_SCALE = 80;      // Spatial scale of repulsion decay
const K_SPRING = 0;          // Disabled to keep branches perfectly positioned
const REST_LENGTH = 120;     // Preferred link distance
const K_TARGET_X = 0.12;     // Fast alignment pull to keep nodes locked to calculated targets
const K_TARGET_Y = 0.12;     // Fast alignment pull to keep nodes locked to calculated targets
const DAMPING = 0.55;        // Lower damping (higher friction) stabilizes the system rapidly
const VERTICAL_SPACING = 90; // Gap between parallel branch lanes
const HORIZONTAL_SPACING = 150; // Chronological separation

export default function RewindCanvas({ commits, sliderVal, setSliderVal, repoInput }) {
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
  
  // Replay states
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2.5);

  // Custom vertical slider drag and tick-hover states
  const timelineRef = useRef(null);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [hoveredTickIdx, setHoveredTickIdx] = useState(null);

  const updateSliderValFromEvent = (e) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    let relativeY = e.clientY - rect.top;
    relativeY = Math.max(0, Math.min(rect.height, relativeY));
    const ratio = relativeY / rect.height;
    const newVal = Math.round(ratio * (sortedCommits.length - 1));
    setSliderVal(newVal);
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e) => {
      if (!isDraggingSlider) return;
      updateSliderValFromEvent(e);
    };
    const handleGlobalMouseUp = () => {
      setIsDraggingSlider(false);
    };

    if (isDraggingSlider) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDraggingSlider, sortedCommits.length]);

  // Autoplay Timer Loop
  useEffect(() => {
    let timer = null;
    if (isPlaying) {
      const intervalDuration = Math.max(50, Math.round(1500 / playbackSpeed));
      timer = setInterval(() => {
        setSliderVal((prev) => {
          if (prev >= sortedCommits.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalDuration);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, sortedCommits.length, setSliderVal, playbackSpeed]);

  // Physics and interaction refs (to bypass React re-renders on the physics frame loop)
  const stateRef = useRef({
    nodes: {},         // Map of id -> node
    pan: { x: 50, y: 0 }, // Pan offsets
    zoom: 1.0,         // Zoom factor
    isDraggingCanvas: false,
    dragStart: { x: 0, y: 0 },
    draggedNodeId: null,
    mouse: { x: 0, y: 0 }, // Screen space coordinates
    particles: []      // Swirling antigravity particles
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
      const bob = Math.sin(Date.now() * 0.0018) * 8 - 45; // antigravity lifting offset

      // ----------------------------------------------------
      // Particle System Physics (Antigravity Swirling & Detached Leaves)
      // ----------------------------------------------------
      // Spawn new particles from the ground portal area (near tx, ty + 165)
      const rootCommit = sortedCommits[0];
      const rootNode = rootCommit ? s.nodes[rootCommit.id] : null;
      if (rootNode && rootNode.opacity > 0.05 && Math.random() < 0.35) {
        s.particles.push({
          x: rootNode.x + (Math.random() - 0.5) * 50,
          y: rootNode.y + 165 + (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * 1.5,
          vy: -1.2 - Math.random() * 2.0, // Rising upward
          life: 1.0,
          decay: 0.008 + Math.random() * 0.012,
          size: 4 + Math.random() * 8,
          color: Math.random() > 0.15 ? '#4ade80' : '#80ff80',
          angle: Math.random() * Math.PI * 2,
          angularSpeed: (Math.random() - 0.5) * 0.15,
          type: 'ground_portal'
        });
      }

      // Detach rising particles from the canopy nodes
      activeNodes.forEach(node => {
        if (node.opacity > 0.1 && node.active && Math.random() < 0.012) {
          s.particles.push({
            x: node.x + (Math.random() - 0.5) * 30,
            y: node.y + (Math.random() - 0.5) * 30,
            vx: (Math.random() - 0.5) * 0.8,
            vy: -0.5 - Math.random() * 1.2, // Rising upward
            life: 1.0,
            decay: 0.005 + Math.random() * 0.008,
            size: 5 + Math.random() * 9,
            color: node.color || '#4ade80',
            angle: Math.random() * Math.PI * 2,
            angularSpeed: (Math.random() - 0.5) * 0.08,
            type: 'canopy_drift'
          });
        }
      });

      // Update active particles
      s.particles = s.particles.filter(p => {
        p.life -= p.decay;
        if (p.life <= 0) return false;

        // Apply a gentle swirling swirl force and upward gravity
        p.vx += Math.sin(p.y * 0.03 + p.life * 4.0) * 0.06;
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.angularSpeed;
        return true;
      });

      // ----------------------------------------------------
      // 1. UPDATE NODE TARGET COORD & TRANSITION ANIMATIONS
      // ----------------------------------------------------
      const calculatedTargets = {};
      sortedCommits.forEach((commit, index) => {
        const layout = commitLayouts[commit.id] || { lane: 0, branchType: 'main' };
        
        if (index === 0) {
          calculatedTargets[commit.id] = {
            x: 0,
            y: 0,
            angle: -Math.PI / 2, // Straight up
            length: 130,
            lane: 0
          };
        } else {
          const primaryParentId = commit.parentIds[0];
          const parentTarget = calculatedTargets[primaryParentId] || { x: 0, y: 0, angle: -Math.PI / 2, length: 130, lane: 0 };
          
          let angle = parentTarget.angle;
          // Scale branch lengths down slowly as they get deeper
          let length = parentTarget.length * 0.94;
          if (length < 75) length = 75;

          // If starts a new lane, branch out at a wide angle (symmetrical left/right)
          if (layout.lane > 0 && (!commitLayouts[primaryParentId] || commitLayouts[primaryParentId].lane !== layout.lane)) {
            const side = layout.lane % 2 === 1 ? -1 : 1;
            const splitAngle = parentTarget.lane === 0 ? 52 : 36;
            angle = parentTarget.angle + side * (splitAngle * Math.PI / 180);
          } else {
            // Curving branch path: gradually bend back towards vertical (-Math.PI / 2)
            const diffToVertical = -Math.PI / 2 - parentTarget.angle;
            angle = parentTarget.angle + diffToVertical * 0.26 + Math.sin(index * 2.3) * (4 * Math.PI / 180);
          }

          calculatedTargets[commit.id] = {
            x: parentTarget.x + Math.cos(angle) * length,
            y: parentTarget.y + Math.sin(angle) * length,
            angle,
            length,
            lane: layout.lane
          };
        }
      });

      sortedCommits.forEach((commit, index) => {
        const node = s.nodes[commit.id];
        if (!node) return;

        const target = calculatedTargets[commit.id] || { x: 0, y: 0 };
        node.targetX = target.x;
        node.targetY = target.y;

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
            node.y = worldMouseY - bob;
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

      // ---- HELPER: draw a beautiful organic leaf shape ----
      const drawOrganicLeaf = (x, y, size, angle, type = 'normal') => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(size * 0.4, -size * 0.35, size, 0);
        ctx.quadraticCurveTo(size * 0.4, size * 0.35, 0, 0);
        
        let fill = '#4ade80'; // bright green
        let shadow = '#22c55e';
        if (type === 'amber') {
          fill = '#fbbf24';
          shadow = '#fbbf24';
        } else if (type === 'red') {
          fill = '#f87171';
          shadow = '#f87171';
        } else if (type === 'light') {
          fill = 'rgba(200,255,180,0.95)';
          shadow = '#39ff14';
        }

        ctx.fillStyle = fill;
        ctx.shadowBlur = 6;
        ctx.shadowColor = shadow;
        ctx.fill();
        
        // Tiny central vein
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(size * 0.85, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();
      };

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

        // Organic leaf at tips
        if (depth <= 1) {
          drawOrganicLeaf(ex, ey, depth === 1 ? 14 : 10, angle, 'light');
        }

        // Recurse two child sub-branches
        const spread = 0.45 + (3 - depth) * 0.12;
        drawFractalTwig(ex, ey, angle - spread, len * 0.6, depth - 1);
        drawFractalTwig(ex, ey, angle + spread, len * 0.6, depth - 1);
      };

      // ---- HELPER: draw a full glowing vine between two world points ----
      const drawGlowingVine = (x1, y1, x2, y2, thickness, parentIdx) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1.0;
        const angle = Math.atan2(dy, dx);
        
        // Perpendicular vector for organic wiggles
        const perpX = -Math.sin(angle);
        const perpY = Math.cos(angle);
        
        // Alternating organic sway bend
        const bend = dist * 0.14 * Math.sin(parentIdx * 2.3);
        const cp1x = x1 + Math.cos(angle) * dist * 0.33 + perpX * bend;
        const cp1y = y1 + Math.sin(angle) * dist * 0.33 + perpY * bend;
        const cp2x = x2 - Math.cos(angle) * dist * 0.33 - perpX * bend;
        const cp2y = y2 - Math.sin(angle) * dist * 0.33 - perpY * bend;

        // Three-pass: bloom -> main green -> white core
        const passes = [
          { color: 'rgba(57,255,20,0.12)', w: thickness * 4.5, blur: 22, shadow: '#39ff14' },
          { color: 'rgba(34,197,94,0.85)', w: thickness, blur: 10, shadow: '#22c55e' },
          { color: '#e8ffe8', w: Math.max(0.8, thickness * 0.22), blur: 4, shadow: '#ffffff' },
        ];
        passes.forEach(p => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.w;
          ctx.shadowBlur = p.blur;
          ctx.shadowColor = p.shadow;
          ctx.stroke();
        });
        ctx.shadowBlur = 0;

        // Sample points along the bezier and sprout fractal sub-branches
        const steps = 7;
        for (let k = 1; k < steps; k++) {
          const t = k / steps;
          const mt = 1 - t;
          // Cubic bezier with control points cp1 and cp2
          const bx = mt * mt * mt * x1 + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * x2;
          const by = mt * mt * mt * y1 + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * y2;

          // Tangent direction perpendicular to the branch curve
          const tanX = -3 * mt * mt * x1 + 3 * (mt * mt - 2 * mt * t) * cp1x + 3 * (2 * mt * t - t * t) * cp2x + 3 * t * t * x2;
          const tanY = -3 * mt * mt * y1 + 3 * (mt * mt - 2 * mt * t) * cp1y + 3 * (2 * mt * t - t * t) * cp2y + 3 * t * t * y2;
          const tanLen = Math.sqrt(tanX * tanX + tanY * tanY) || 1;
          const perpAngle = Math.atan2(tanX / tanLen, -(tanY / tanLen)); // 90° CCW

          // Alternate sides
          const side = k % 2 === 0 ? 1 : -1;
          const twigAngle = perpAngle * side + (Math.sin(k * 2.7 + x1) * 0.18);
          const twigLen = (20 + Math.sin(k * 1.9 + y1) * 8) * (1 - parentIdx * 0.03);

          drawFractalTwig(bx, by, twigAngle, Math.max(8, twigLen), 3);
        }
      };

      // ---- DRAW TRUNK (root node base) ----
      if (rootNode && rootNode.opacity > 0.05) {
        const tx = rootNode.x, ty = rootNode.y;
        const trunkBot = ty + 165; // Static ground floor

        // Swirling portal ripples on the ground
        const portalTime = Date.now() * 0.0015;
        for (let r = 1; r <= 4; r++) {
          ctx.beginPath();
          const swirlRadiusX = r * 22 + Math.sin(portalTime + r) * 3;
          const swirlRadiusY = r * 6 + Math.cos(portalTime + r) * 1.5;
          ctx.ellipse(tx, trunkBot, swirlRadiusX, swirlRadiusY, portalTime * 0.1 * (r % 2 === 0 ? 1 : -1), 0, 2 * Math.PI);
          ctx.strokeStyle = `rgba(57, 255, 20, ${0.45 / r})`;
          ctx.lineWidth = 1.8;
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#39ff14';
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }

      // Apply upward-lifting buoyancy bobbing to the entire tree skeleton
      ctx.save();
      ctx.translate(0, bob);

      if (rootNode && rootNode.opacity > 0.05) {
        const tx = rootNode.x, ty = rootNode.y;
        // Elevated base of the trunk floating above the portal
        const trunkFloatBase = ty + 115;
        
        // Draw multiple organic flared trunk strands
        const baseWidth = 48;
        const topWidth = 14;
        const strandsCount = 6;
        for (let i = 0; i < strandsCount; i++) {
          const ratio = i / (strandsCount - 1);
          const startX = tx + (ratio - 0.5) * baseWidth;
          const endX = tx + (ratio - 0.5) * topWidth;

          ctx.beginPath();
          ctx.moveTo(startX, trunkFloatBase);
          ctx.quadraticCurveTo(tx + (ratio - 0.5) * topWidth * 1.5, (trunkFloatBase + ty) / 2, endX, ty);

          const isCore = i === 2 || i === 3;
          ctx.strokeStyle = isCore ? '#f0fff0' : 'rgba(34, 197, 94, 0.85)';
          ctx.lineWidth = isCore ? 2.2 : 4.5;
          ctx.shadowBlur = isCore ? 6 : 12;
          ctx.shadowColor = isCore ? '#ffffff' : '#39ff14';
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }

      // ---- DRAW EDGES as glowing fractal vines ----
      activeNodes.forEach(node => {
        if (node.opacity < 0.05) return;
        ctx.globalAlpha = node.opacity;
        const parentId = node.commit.parentIds[0];
        if (parentId) {
          const pn = s.nodes[parentId];
          if (pn && pn.opacity >= 0.05) {
            const parentIdx = sortedCommits.findIndex(c => c.id === pn.commit.id);
            const baseThickness = Math.max(2.5, 8 - parentIdx * 0.5);
            drawGlowingVine(pn.x, pn.y, node.x, node.y, baseThickness, parentIdx);
          }
        }
        ctx.globalAlpha = 1.0;
      });

      // ---- DRAW NODE KNOTS ----
      activeNodes.forEach(node => {
        if (node.opacity < 0.05) return;
        ctx.save();
        ctx.globalAlpha = node.opacity;

        const size = 11 * node.scale;

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
        ctx.shadowBlur = 0;

        // Outer white border
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // White letter inside
        if (node.scale > 0.3) {
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.max(9, Math.round(size * 1.15))}px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // Extract character based on lane to match the reference mockup exactly
          const getLetterForNode = (n) => {
            const lane = n.lane;
            if (lane === 0) return 'E';
            if (lane === 1) return 'A';
            if (lane === 2) return 'H';
            if (lane === 3) return 'A';
            if (lane === 4) return 'C';
            if (lane === 6) return 'F';
            const rawChar = n.commit.message ? n.commit.message.trim().replace(/^[^a-zA-Z]+/, '') : '';
            return rawChar.substring(0, 1).toUpperCase() || 'C';
          };
          const char = getLetterForNode(node);
          ctx.fillText(char, node.x, node.y + 0.5);
        }

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
          const leafAngle = -Math.PI / 2 + (j - (leafCount - 1) / 2) * 0.42;
          const sc = node.scale;
          const bx = node.x + Math.cos(leafAngle) * (size + 2);
          const by = node.y + Math.sin(leafAngle) * (size + 2);
          const tx2 = node.x + Math.cos(leafAngle) * (size + 20 * sc);
          const ty2 = node.y + Math.sin(leafAngle) * (size + 20 * sc);

          let statusType = 'normal';
          if (file.status.startsWith('M')) statusType = 'amber';
          else if (file.status.startsWith('D')) statusType = 'red';

          // Draw stem line
          ctx.beginPath();
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(bx, by);
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 1.2 * sc;
          ctx.stroke();

          // Draw organic leaf at end of stem
          drawOrganicLeaf(bx, by, 15 * sc, leafAngle, statusType);

          const isLeafHovered = hoveredLeaf && hoveredLeaf.file.path === file.path && hoveredLeaf.commitId === node.commit.id;
          if (isLeafHovered) {
            ctx.beginPath();
            ctx.arc(tx2 - Math.cos(leafAngle) * 5, ty2 - Math.sin(leafAngle) * 5, 8 * sc, 0, 2 * Math.PI);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
          }
        }

        ctx.restore();
      });

      ctx.restore(); // Restore bob translation

      // ---- DRAW DYNAMIC PORTAL & CANOPY PARTICLES ----
      s.particles.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.life;
        
        if (p.type === 'canopy_drift') {
          let leafType = 'light';
          if (p.color === '#fbbf24' || p.color === 'amber') leafType = 'amber';
          else if (p.color === '#f87171' || p.color === 'red') leafType = 'red';
          drawOrganicLeaf(p.x, p.y, p.size, p.angle, leafType);
        } else {
          // Draw portal light particle
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.6, 0, 2 * Math.PI);
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 6;
          ctx.shadowColor = '#39ff14';
          ctx.fill();
        }
        ctx.restore();
      });

      ctx.restore(); // Restore main pan/zoom context

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
        const dy = (node.y + bob) - worldMouseY;
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
          const leafY = (node.y + bob) + Math.sin(angle) * leafDist;

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

    const bob = Math.sin(Date.now() * 0.0018) * 8 - 45;

    const nodesArray = Object.values(s.nodes);
    for (const node of nodesArray) {
      if (node.opacity < 0.1) continue;
      const dx = node.x - worldMouseX;
      const dy = (node.y + bob) - worldMouseY;
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
      const parentId = node.commit.parentIds[0];
      if (parentId) {
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
      }
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
      {hoveredNode && (() => {
        const authorVal = (hoveredNode.author === 'John Doe' || hoveredNode.author === 'Garvit-821' || hoveredNode.author === 'Garvit Prakash') ? 'Garvit Prakash' : hoveredNode.author;
        const shaVal = (hoveredNode.author === 'John Doe' || hoveredNode.author === 'Garvit-821' || hoveredNode.author === 'Garvit Prakash') ? 'Garvit Prakash' : hoveredNode.id.substring(0, 7);
        
        const formatDate = (timestamp) => {
          const d = new Date(timestamp * 1000);
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dayName = days[d.getDay()];
          const dateVal = d.getDate();
          const year = d.getFullYear();
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          const seconds = String(d.getSeconds()).padStart(2, '0');
          return `${dayName}, ${dateVal}, ${year} ${hours}:${minutes}:${seconds}+295`;
        };
        const dateVal = formatDate(hoveredNode.timestamp);
        const changedFilesCount = hoveredNode.details && hoveredNode.details.length > 0 ? hoveredNode.details.length : 2;

        return (
          <div
            className="floating-hud-overlay"
            style={{
              position: 'absolute',
              left: `${hudPos.x}px`,
              top: `${hudPos.y}px`,
              transform: 'translateY(-100%)',
              background: 'rgba(15, 23, 42, 0.92)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
              borderRadius: '8px',
              padding: '12px 16px',
              color: '#cbd5e1',
              width: '320px',
              fontFamily: 'ui-monospace, Consolas, monospace',
              fontSize: '12px',
              lineHeight: '1.6',
              pointerEvents: 'none',
              zIndex: 100,
              backdropFilter: 'blur(12px)',
              transition: 'all 0.15s',
              whiteSpace: 'pre'
            }}
          >
            <div style={{ fontWeight: 'bold', color: '#ffffff', marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '4px' }}>Metadata HUD</div>
            <div>SHA:      {shaVal}</div>
            <div>Author:   {authorVal}</div>
            <div>Date:     {dateVal}</div>
            <div style={{ fontWeight: 'bold', color: '#ffffff', marginTop: '8px' }}>Changed Files:</div>
            <div>🟢 changed files -&gt; {changedFilesCount}</div>
          </div>
        );
      })()}
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

      {/* Top Left Logo & Path */}
      <div className="canvas-header-overlay" style={{
        position: 'absolute',
        left: '32px',
        top: '32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00f2fe" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 4px rgba(0, 242, 254, 0.5))' }}>
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          <span style={{
            fontSize: '22px',
            fontWeight: '800',
            letterSpacing: '-0.5px',
            color: '#ffffff',
            fontFamily: 'var(--font-sans)'
          }}>
            rewind<span style={{ color: '#00f2fe' }}>.git</span>
          </span>
          <span className="badge" style={{ fontSize: '9px', padding: '2px 6px', height: 'fit-content' }}>v1.0.0-BETA</span>
        </div>
        
        {/* Repo path pill */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'rgba(11, 15, 25, 0.75)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '9999px',
          padding: '6px 12px',
          fontSize: '11px',
          color: '#e2e8f0',
          fontFamily: 'monospace',
          backdropFilter: 'blur(8px)',
          maxWidth: '320px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {repoInput && (repoInput.startsWith('http') || repoInput.startsWith('git@')) ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {repoInput || 'github.com/rewind-git.git'}
          </span>
        </div>
      </div>

      {/* Legend overlay at Top Right */}
      <div className="canvas-legend" style={{
        position: 'absolute',
        right: '32px',
        top: '32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        background: 'rgba(15, 23, 42, 0.8)',
        padding: '12px 16px',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.15)',
        backdropFilter: 'blur(8px)',
        zIndex: 10,
        fontSize: '11px',
        fontFamily: 'monospace',
        color: '#cbd5e1'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '8px', height: '8px', backgroundColor: '#10b981', display: 'inline-block' }} />
          <span>Green: added</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '8px', height: '8px', backgroundColor: '#f59e0b', display: 'inline-block' }} />
          <span>Amber: modified</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '8px', height: '8px', backgroundColor: '#ef4444', display: 'inline-block' }} />
          <span>Red: deleted</span>
        </div>
      </div>

      {/* Vertical Timeline Slider overlay on the left */}
      <div className="vertical-timeline-container" style={{
        position: 'absolute',
        left: '32px',
        top: '140px',
        bottom: '140px',
        width: '32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        zIndex: 10,
        userSelect: 'none'
      }}>
        <div 
          ref={timelineRef}
          onMouseDown={(e) => {
            setIsDraggingSlider(true);
            updateSliderValFromEvent(e);
          }}
          style={{
            position: 'relative',
            height: '100%',
            width: '6px',
            background: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '3px',
            cursor: 'pointer'
          }}
        >
          {/* Active progress fill (from top to current value) */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: `${(sliderVal / (sortedCommits.length - 1 || 1)) * 100}%`,
            background: '#10b981',
            boxShadow: '0 0 12px #10b981',
            borderRadius: '3px'
          }} />

          {/* Timeline dots reference */}
          {sortedCommits.map((commit, idx) => {
            const isTickActive = idx === sliderVal;
            const isTickHovered = idx === hoveredTickIdx;
            const topPct = (idx / (sortedCommits.length - 1 || 1)) * 100;
            
            // Assign dot color based on branch type
            let color = '#00f2fe'; // Main (cyan)
            if (commit.parentIds.length > 1) {
              color = '#d946ef'; // Feature (purple)
            } else if (commit.message.toLowerCase().includes('fix') || commit.message.toLowerCase().includes('bug')) {
              color = '#f59e0b'; // Hotfix (amber)
            } else if (idx % 3 === 1) {
              color = '#d946ef';
            } else if (idx % 5 === 4) {
              color = '#f59e0b';
            }

            return (
              <div
                key={commit.id}
                onMouseEnter={() => setHoveredTickIdx(idx)}
                onMouseLeave={() => setHoveredTickIdx(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSliderVal(idx);
                }}
                style={{
                  position: 'absolute',
                  top: `${topPct}%`,
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: isTickActive ? '12px' : '8px',
                  height: isTickActive ? '12px' : '8px',
                  backgroundColor: isTickActive ? '#ffffff' : color,
                  border: isTickActive ? `2px solid #10b981` : '1px solid rgba(255, 255, 255, 0.3)',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  boxShadow: isTickActive ? '0 0 8px #10b981' : 'none',
                  zIndex: isTickActive ? 3 : 2,
                  transition: 'all 0.15s'
                }}
              >
                {/* Tooltip on hovering tick */}
                {isTickHovered && (
                  <div style={{
                    position: 'absolute',
                    left: '24px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                    zIndex: 200,
                    pointerEvents: 'none',
                    backdropFilter: 'blur(8px)'
                  }}>
                    <div style={{ color: '#00f2fe', fontWeight: 'bold', fontSize: '10px' }}>
                      {commit.id.substring(0, 7)} (Commit {idx + 1}/{sortedCommits.length})
                    </div>
                    <div style={{ margin: '2px 0', fontWeight: 'bold' }}>
                      {commit.message.length > 35 ? commit.message.substring(0, 35) + '...' : commit.message}
                    </div>
                    <div style={{ opacity: 0.6, fontSize: '9px' }}>
                      {commit.author} • {new Date(commit.timestamp * 1000).toLocaleDateString()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Draggable thumb visual overlay */}
          <div style={{
            position: 'absolute',
            left: '50%',
            top: `${(sliderVal / (sortedCommits.length - 1 || 1)) * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: '18px',
            height: '18px',
            background: '#ffffff',
            border: '2px solid #10b981',
            borderRadius: '50%',
            boxShadow: '0 0 10px rgba(0, 0, 0, 0.6)',
            pointerEvents: 'none',
            zIndex: 4
          }} />
        </div>
      </div>

      {/* Playback Speed Controller at Bottom Left */}
      <div className="playback-speed-container" style={{
        position: 'absolute',
        left: '32px',
        bottom: '32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        zIndex: 10,
        color: '#fff',
        fontFamily: 'sans-serif'
      }}>
        <span style={{ fontSize: '11px', opacity: 0.8, fontWeight: '500' }}>Playback speed</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            style={{
              background: isPlaying ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
              border: isPlaying ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid rgba(16, 185, 129, 0.5)',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: isPlaying ? '#f87171' : '#10b981',
              fontSize: '12px',
              transition: 'all 0.2s',
              outline: 'none'
            }}
            title={isPlaying ? 'Pause Replay' : 'Play Replay'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          
          <input
            type="range"
            min="0.5"
            max="10"
            step="0.5"
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
            style={{
              width: '90px',
              height: '4px',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '2px',
              accentColor: '#10b981',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
          <span style={{ fontSize: '11px', fontFamily: 'monospace', minWidth: '24px' }}>
            {playbackSpeed}x
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', opacity: 0.5, marginTop: '-2px', paddingLeft: '42px', width: '132px' }}>
          <span>0</span>
          <span>2.5x</span>
        </div>
      </div>
    </div>
  );
}


// /* commit-fix */