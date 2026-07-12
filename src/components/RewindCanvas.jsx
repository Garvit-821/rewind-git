import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// Neon colors assigned to branches
const BRANCH_COLORS = {
  main: '#00f2fe',    // Neon Cyan
  feature: '#d946ef', // Neon Purple/Magenta
  hotfix: '#f59e0b',  // Neon Amber
};

// Physics constants for 2D coord engine (used as coordinate brain)
const K_TARGET_X = 0.15;
const K_TARGET_Y = 0.15;
const DAMPING = 0.6;
const VERTICAL_SPACING = 90;

export default function RewindCanvas({ commits, sliderVal, setSliderVal, repoInput }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const threeRef = useRef(null);

  // Parse and sort commits chronologically (oldest first)
  const sortedCommits = useMemo(() => {
    return [...commits].sort((a, b) => a.timestamp - b.timestamp);
  }, [commits]);

  const isSample = useMemo(() => {
    return sortedCommits.length > 0 && (
      sortedCommits[0].id === 'a4ab7e7e0ca303dbb9bcb7f3a7d3e0c31560220f' ||
      sortedCommits[0].id === '7f59e2a6fad353762336cc6f237db8b56cc56db4'
    );
  }, [sortedCommits]);

  const getParentId = (nodeOrId) => {
    const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.commit.id;
    if (isSample) {
      const sampleParents = {
        '00a68b543ed15bfc81d4a8af8daaf7ae12a3b90b': 'a4ab7e7e0ca303dbb9bcb7f3a7d3e0c31560220f',
        '57237f7376dcb1b7b7405e3fe522cc4f9cec5306': 'a4ab7e7e0ca303dbb9bcb7f3a7d3e0c31560220f',
        '5d8fef7c8c0e01a23aee467750937d6faca2da67': '00a68b543ed15bfc81d4a8af8daaf7ae12a3b90b',
        '621a52e486491d0727e057b8cdaa9321c1f90475': '00a68b543ed15bfc81d4a8af8daaf7ae12a3b90b',
        '00acb944a530d0825fc0299a73bddc687a7ca543': 'a4ab7e7e0ca303dbb9bcb7f3a7d3e0c31560220f',
        'a4278361045e23bb0712f01e1c0e1d033bdb7118': '00acb944a530d0825fc0299a73bddc687a7ca543',
        '82da6dc2168560e7514e2fadb357f842d719412e': '00acb944a530d0825fc0299a73bddc687a7ca543',
        'cbe13115cc5355ae3aac7fbc94e00b1ab533eabb': '00acb944a530d0825fc0299a73bddc687a7ca543'
      };
      return sampleParents[id] || null;
    }
    if (typeof nodeOrId === 'string') {
      const commitObj = sortedCommits.find(c => c.id === id);
      return commitObj?.parentIds?.[0] || null;
    }
    return nodeOrId.commit.parentIds?.[0] || null;
  };

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

  // Physics and interaction refs (acts as the 2D positioning brain)
  const stateRef = useRef({
    nodes: {},
    pan: { x: 0, y: 0 },
    zoom: 1.0,
    mouse: { x: 0, y: 0 },
    isDraggingCanvas: false
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

        if (activeHeads[parentLane] === primaryParentId) {
          lane = parentLane;
          activeHeads[parentLane] = commit.id;
        } else {
          lane = nextLaneId++;
          activeHeads[lane] = commit.id;
        }
      } else {
        lane = 0;
        activeHeads[0] = commit.id;
      }

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
    sortedCommits.forEach((commit) => {
      const layout = commitLayouts[commit.id] || { lane: 0, branchType: 'main', color: '#fff' };
      let yOffset = 0;
      if (layout.lane > 0) {
        const direction = layout.lane % 2 === 1 ? -1 : 1;
        const multiplier = Math.ceil(layout.lane / 2);
        yOffset = direction * multiplier * VERTICAL_SPACING;
      }

      if (!s.nodes[commit.id]) {
        let spawnX = 0;
        let spawnY = 0;
        const parentId = getParentId(commit.id);
        if (parentId && s.nodes[parentId]) {
          spawnX = s.nodes[parentId].x;
          spawnY = s.nodes[parentId].y + yOffset / 2;
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

    const commitIdSet = new Set(sortedCommits.map(c => c.id));
    Object.keys(s.nodes).forEach(id => {
      if (!commitIdSet.has(id)) {
        delete s.nodes[id];
      }
    });
  }, [sortedCommits, commitLayouts]);

  // Update node active state
  useEffect(() => {
    const s = stateRef.current;
    sortedCommits.forEach((commit, index) => {
      const node = s.nodes[commit.id];
      if (node) {
        node.active = index <= sliderVal;
      }
    });
  }, [sliderVal, sortedCommits]);

  // Helper mapping function from 2D coordinates to 3D Scene Space
  const get3DCoords = (x2d, y2d, index = 0) => {
    const scale = 0.045;
    const x = x2d * scale;
    const y = -y2d * scale - 4.5; // Offset trunk base nicely
    // Add sinusoidal depth to branch splits for true 3D spatial separation
    const z = Math.sin(x2d * 0.045) * 3.0 + Math.cos(index * 1.5) * 0.8;
    return new THREE.Vector3(x, y, z);
  };

  // Three.js scene initializer & tick controller
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // WebGL Renderer with preserved drawing buffer for webm recording
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;

    // Scene setup with atmospheric fog
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050e14, 0.018);

    // Camera setup
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 2, 16);

    // Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.15; // Limit under-floor camera angles
    controls.minDistance = 3;
    controls.maxDistance = 35;

    // Post processing setup for neon bloom rendering
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.9,  // strength
      0.45, // radius
      0.22  // threshold
    );
    composer.addPass(bloomPass);

    // --------------------------------------------------------
    // LIGHTING SYSTEM
    // --------------------------------------------------------
    const ambientLight = new THREE.AmbientLight(0x0a1622, 1.2);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xd9f2ff, 1.5);
    sunLight.position.set(12, 20, 8);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 40;
    const d = 15;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    scene.add(sunLight);

    // --------------------------------------------------------
    // PROCEDURAL TEXTURE GENERATION
    // --------------------------------------------------------
    // Dynamic 2D canvas drawing a highly detailed wood bark pattern
    const generateBarkTexture = () => {
      const texCanvas = document.createElement('canvas');
      texCanvas.width = 512;
      texCanvas.height = 512;
      const ctx = texCanvas.getContext('2d');
      // Woody dark brown base
      ctx.fillStyle = '#1c120c';
      ctx.fillRect(0, 0, 512, 512);

      // Organic bark fibers
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#261910' : '#120a06';
        const w = Math.random() * 5 + 2;
        const h = Math.random() * 200 + 40;
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        ctx.fillRect(x, y, w, h);
      }
      // Glowing moss patches
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = 'rgba(28, 64, 18, 0.45)';
        ctx.beginPath();
        ctx.arc(Math.random() * 512, Math.random() * 512, Math.random() * 25 + 10, 0, Math.PI * 2);
        ctx.fill();
      }

      const tex = new THREE.CanvasTexture(texCanvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 4);
      return tex;
    };
    const barkTexture = generateBarkTexture();

    // Procedural Leaf texture canvas
    const generateLeafTexture = () => {
      const texCanvas = document.createElement('canvas');
      texCanvas.width = 128;
      texCanvas.height = 128;
      const ctx = texCanvas.getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 128, 128);

      // Draw pointed organic leaf
      ctx.fillStyle = '#16a34a';
      ctx.beginPath();
      ctx.moveTo(64, 8);
      ctx.quadraticCurveTo(116, 50, 64, 120);
      ctx.quadraticCurveTo(12, 50, 64, 8);
      ctx.fill();

      // Leaf rib veins
      ctx.strokeStyle = '#a7f3d0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(64, 8);
      ctx.lineTo(64, 110);
      ctx.stroke();

      for (let i = 0; i < 4; i++) {
        const y = 30 + i * 20;
        ctx.beginPath();
        ctx.moveTo(64, y);
        ctx.quadraticCurveTo(34, y + 10, 26, y + 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(64, y);
        ctx.quadraticCurveTo(94, y + 10, 102, y + 5);
        ctx.stroke();
      }

      const tex = new THREE.CanvasTexture(texCanvas);
      return tex;
    };
    const leafTexture = generateLeafTexture();

    // Materials setup
    const barkMaterial = new THREE.MeshStandardMaterial({
      map: barkTexture,
      roughness: 0.88,
      metalness: 0.1,
      bumpMap: barkTexture,
      bumpScale: 0.06
    });

    const leafMaterial = new THREE.MeshStandardMaterial({
      map: leafTexture,
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.5,
      metalness: 0.1,
      shadowSide: THREE.DoubleSide
    });

    // Custom shader material to taper branches organically using onBeforeCompile
    const branchMaterial = barkMaterial.clone();
    branchMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        // Taper branch thickness smoothly from parent base (uv.y=0) to child tip (uv.y=1)
        transformed.xz *= (1.0 - uv.y * 0.65);
        `
      );
    };

    // --------------------------------------------------------
    // GROUND SWIRLING PORTAL (Concentrically rotating rings)
    // --------------------------------------------------------
    const portalGroup = new THREE.Group();
    portalGroup.position.set(0, -6.5, 0);
    scene.add(portalGroup);

    const portalRings = [];
    const ringColors = [0x10b981, 0x059669, 0x047857];
    for (let r = 0; r < 3; r++) {
      const radius = 1.0 + r * 0.9;
      const ringGeo = new THREE.TorusGeometry(radius, 0.05, 8, 48);
      const ringMat = new THREE.MeshStandardMaterial({
        color: ringColors[r],
        emissive: ringColors[r],
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 0.7 - r * 0.18
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      portalGroup.add(ringMesh);
      portalRings.push({
        mesh: ringMesh,
        speed: (0.8 + r * 0.4) * (r % 2 === 0 ? 1 : -1)
      });
    }

    // --------------------------------------------------------
    // ETHEREAL FAIRY DUST PARTICLES
    // --------------------------------------------------------
    const particleCount = 600;
    const particleGeometry = new THREE.BufferGeometry();
    const particlePosArray = new Float32Array(particleCount * 3);
    const particleData = [];

    for (let i = 0; i < particleCount; i++) {
      const radius = 1.2 + Math.random() * 7.0;
      const angle = Math.random() * Math.PI * 2;
      const x = Math.sin(angle) * radius;
      const y = -6.5 + Math.random() * 18.0;
      const z = Math.cos(angle) * radius;

      particlePosArray[i * 3] = x;
      particlePosArray[i * 3 + 1] = y;
      particlePosArray[i * 3 + 2] = z;

      particleData.push({
        radius,
        angle,
        speed: 0.15 + Math.random() * 0.4,
        yVelocity: 0.8 + Math.random() * 1.5,
        originalRadius: radius
      });
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePosArray, 3));
    const particleMaterial = new THREE.PointsMaterial({
      size: 0.09,
      color: 0x39ff14,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    const particlePoints = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particlePoints);

    // --------------------------------------------------------
    // RENDER HOOK DATA CONTAINERS
    // --------------------------------------------------------
    const commitGroups = {};   // id -> Group containing sphere node, lights, labels, leaf clusters
    const branchMeshes = {};   // childId -> branch Mesh
    const leafClusters = {};   // childId -> leaf cluster Groups

    // Setup global state container inside ref for rendering updates
    threeRef.current = {
      scene,
      camera,
      renderer,
      controls,
      composer,
      commitGroups,
      branchMeshes,
      leafClusters,
      barkMaterial,
      leafMaterial,
      branchMaterial,
      portalRings,
      particleGeometry,
      particleData,
      activeTargetFocus: null
    };

    // --------------------------------------------------------
    // RESIZE EVENT HANDLER
    // --------------------------------------------------------
    const handleResize = () => {
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // --------------------------------------------------------
    // CLICK INTERACTION RAYCASTING
    // --------------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const mouse2D = new THREE.Vector2();

    const handleCanvasClick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      mouse2D.x = (x / rect.width) * 2 - 1;
      mouse2D.y = -(y / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse2D, camera);
      
      const clickableSpheres = [];
      Object.keys(commitGroups).forEach(id => {
        const sphere = commitGroups[id].getObjectByName('nodeSphere');
        if (sphere && sphere.visible) {
          clickableSpheres.push(sphere);
        }
      });

      const intersects = raycaster.intersectObjects(clickableSpheres);
      if (intersects.length > 0) {
        const clickedSphere = intersects[0].object;
        const targetId = clickedSphere.userData.commitId;
        const targetIdx = sortedCommits.findIndex(c => c.id === targetId);
        if (targetIdx !== -1) {
          setSliderVal(targetIdx);
        }
      }
    };
    canvas.addEventListener('click', handleCanvasClick);

    // Mouse move hover detector
    const handleCanvasMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      mouse2D.x = (x / rect.width) * 2 - 1;
      mouse2D.y = -(y / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse2D, camera);

      const clickableSpheres = [];
      Object.keys(commitGroups).forEach(id => {
        const sphere = commitGroups[id].getObjectByName('nodeSphere');
        if (sphere && sphere.visible) {
          clickableSpheres.push(sphere);
        }
      });

      const intersects = raycaster.intersectObjects(clickableSpheres);
      if (intersects.length > 0) {
        const hoveredSphere = intersects[0].object;
        const targetId = hoveredSphere.userData.commitId;
        const nodeData = stateRef.current.nodes[targetId];

        if (nodeData) {
          setHoveredNode(nodeData.commit);
          setHoveredLeaf(null);
          setHudPos({ x: x + 25, y: y - 25 });
          canvas.style.cursor = 'pointer';
        }
      } else {
        setHoveredNode(null);
        canvas.style.cursor = 'grab';
      }
    };
    canvas.addEventListener('mousemove', handleCanvasMouseMove);

    // --------------------------------------------------------
    // MAIN RENDERING LOOP (physics ticks & Three.js syncs)
    // --------------------------------------------------------
    let lastTime = Date.now();
    const clock = new THREE.Clock();

    const animateScene = () => {
      const currentFrameId = requestAnimationFrame(animateScene);
      const now = Date.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const elapsed = clock.getElapsedTime();

      // Controls update
      controls.update();

      // Portal rings rotation
      portalRings.forEach(ring => {
        ring.mesh.rotation.z += ring.speed * dt * 0.45;
      });

      // Fairy dust particle float system
      const positions = particleGeometry.attributes.position.array;
      for (let i = 0; i < particleCount; i++) {
        const p = particleData[i];
        p.angle += p.speed * dt * 0.8;
        
        // Sway spiral coordinates
        positions[i * 3] = Math.sin(p.angle) * p.radius;
        positions[i * 3 + 1] += p.yVelocity * dt;
        positions[i * 3 + 2] = Math.cos(p.angle) * p.radius;

        // Loop dust to base
        if (positions[i * 3 + 1] > 12.0) {
          positions[i * 3 + 1] = -6.5;
          p.radius = p.originalRadius;
        }
      }
      particleGeometry.attributes.position.needsUpdate = true;

      // ----------------------------------------------------
      // 2D COORDINATE ENGINE TICK
      // ----------------------------------------------------
      const s = stateRef.current;
      const nodeKeys = Object.keys(s.nodes);
      const activeNodes = nodeKeys.map(k => s.nodes[k]);

      // Layout Targets calculation
      const calculatedTargets = {};
      if (isSample) {
        const sampleCoords = {
          'a4ab7e7e0ca303dbb9bcb7f3a7d3e0c31560220f': { x: 0, y: -250, angle: -Math.PI / 2, length: 150, lane: 0 },
          '7f59e2a6fad353762336cc6f237db8b56cc56db4': { x: 0, y: -250, angle: -Math.PI / 2, length: 150, lane: 0 },
          '00a68b543ed15bfc81d4a8af8daaf7ae12a3b90b': { x: -180, y: -150, angle: -Math.PI * 0.75, length: 120, lane: 1 },
          '57237f7376dcb1b7b7405e3fe522cc4f9cec5306': { x: 180, y: -150, angle: -Math.PI * 0.25, length: 120, lane: 2 },
          '5d8fef7c8c0e01a23aee467750937d6faca2da67': { x: -240, y: -300, angle: -Math.PI * 0.8, length: 120, lane: 3 },
          '621a52e486491d0727e057b8cdaa9321c1f90475': { x: -240, y: -300, angle: -Math.PI * 0.8, length: 120, lane: 3 },
          '00acb944a530d0825fc0299a73bddc687a7ca543': { x: 120, y: -320, angle: -Math.PI * 0.3, length: 120, lane: 4 },
          'a4278361045e23bb0712f01e1c0e1d033bdb7118': { x: 240, y: -390, angle: -Math.PI * 0.25, length: 120, lane: 6 },
          '82da6dc2168560e7514e2fadb357f842d719412e': { x: 240, y: -390, angle: -Math.PI * 0.25, length: 120, lane: 6 },
          'cbe13115cc5355ae3aac7fbc94e00b1ab533eabb': { x: 240, y: -390, angle: -Math.PI * 0.25, length: 120, lane: 6 }
        };

        sortedCommits.forEach((commit) => {
          const coord = sampleCoords[commit.id] || { x: 0, y: -250, angle: -Math.PI / 2, length: 150, lane: 0 };
          calculatedTargets[commit.id] = { x: coord.x, y: coord.y, angle: coord.angle, length: coord.length, lane: coord.lane };
        });
      } else {
        sortedCommits.forEach((commit, index) => {
          const layout = commitLayouts[commit.id] || { lane: 0, branchType: 'main' };
          
          if (index === 0) {
            calculatedTargets[commit.id] = { x: 0, y: 0, angle: -Math.PI / 2, length: 130, lane: 0 };
          } else {
            const primaryParentId = commit.parentIds[0];
            const parentTarget = calculatedTargets[primaryParentId] || { x: 0, y: 0, angle: -Math.PI / 2, length: 130, lane: 0 };
            
            let angle = parentTarget.angle;
            let length = parentTarget.length * 0.94;
            if (length < 75) length = 75;

            if (layout.lane > 0 && (!commitLayouts[primaryParentId] || commitLayouts[primaryParentId].lane !== layout.lane)) {
              const side = layout.lane % 2 === 1 ? -1 : 1;
              const splitAngle = parentTarget.lane === 0 ? 52 : 36;
              angle = parentTarget.angle + side * (splitAngle * Math.PI / 180);
            } else {
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
      }

      // Smooth visual growth physics tick
      sortedCommits.forEach((commit, index) => {
        const node = s.nodes[commit.id];
        if (!node) return;

        const target = calculatedTargets[commit.id] || { x: 0, y: 0 };
        node.targetX = target.x;
        node.targetY = target.y;

        const targetScale = node.active ? 1.0 : 0.0;
        node.scale += (targetScale - node.scale) * 0.15;
        node.opacity += (targetScale - node.opacity) * 0.15;

        // Position interpolation
        if (!node.active) {
          const parentId = getParentId(node);
          const parentNode = parentId ? s.nodes[parentId] : null;
          if (parentNode) {
            node.x += (parentNode.x - node.x) * 0.2;
            node.y += (parentNode.y - node.y) * 0.2;
          } else {
            node.x += (0 - node.x) * 0.2;
            node.y += (0 - node.y) * 0.2;
          }
        } else {
          node.x += (node.targetX - node.x) * K_TARGET_X;
          node.y += (node.targetY - node.y) * K_TARGET_Y;
        }
      });

      // ----------------------------------------------------
      // THREE.JS SCENE SYNCHRONIZATION
      // ----------------------------------------------------
      sortedCommits.forEach((commit, index) => {
        const node = s.nodes[commit.id];
        if (!node) return;

        // 1. Synchronize or create commit groups (Sphere + PointLight + Text Sprite)
        let group = commitGroups[commit.id];
        if (!group) {
          group = new THREE.Group();
          scene.add(group);
          commitGroups[commit.id] = group;

          // Glowing glassmorphic Sphere
          const sphereGeo = new THREE.SphereGeometry(0.55, 32, 32);
          const sphereMat = new THREE.MeshPhysicalMaterial({
            color: node.color,
            emissive: node.color,
            emissiveIntensity: 0.6,
            roughness: 0.1,
            metalness: 0.15,
            transmission: 0.75, // Glassmorphic
            thickness: 0.4,
            transparent: true,
            opacity: 0.8
          });
          const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
          sphereMesh.name = 'nodeSphere';
          sphereMesh.userData = { commitId: commit.id };
          sphereMesh.castShadow = true;
          group.add(sphereMesh);

          // Point Light inside node casting breathing neon light
          const pointLight = new THREE.PointLight(node.color, 2.5, 6, 2.0);
          pointLight.name = 'nodeLight';
          group.add(pointLight);

          // Billboard Text Sprite
          const getLetterForNode = (n) => {
            if (isSample) {
              const sampleLetters = {
                'a4ab7e7e0ca303dbb9bcb7f3a7d3e0c31560220f': 'E', '7f59e2a6fad353762336cc6f237db8b56cc56db4': 'E',
                '00a68b543ed15bfc81d4a8af8daaf7ae12a3b90b': 'A', '57237f7376dcb1b7b7405e3fe522cc4f9cec5306': 'H',
                '5d8fef7c8c0e01a23aee467750937d6faca2da67': 'A', '621a52e486491d0727e057b8cdaa9321c1f90475': 'A',
                '00acb944a530d0825fc0299a73bddc687a7ca543': 'C', 'a4278361045e23bb0712f01e1c0e1d033bdb7118': 'F',
                '82da6dc2168560e7514e2fadb357f842d719412e': 'F', 'cbe13115cc5355ae3aac7fbc94e00b1ab533eabb': 'F'
              };
              return sampleLetters[n.commit.id] || 'E';
            }
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
          const letter = getLetterForNode(node);

          const txtCanvas = document.createElement('canvas');
          txtCanvas.width = 128;
          txtCanvas.height = 128;
          const txtCtx = txtCanvas.getContext('2d');
          txtCtx.clearRect(0, 0, 128, 128);
          // Dark green circle backdrop
          txtCtx.fillStyle = '#052e16';
          txtCtx.strokeStyle = '#ffffff';
          txtCtx.lineWidth = 8;
          txtCtx.beginPath();
          txtCtx.arc(64, 64, 56, 0, Math.PI * 2);
          txtCtx.fill();
          txtCtx.stroke();
          // Bold centered text
          txtCtx.fillStyle = '#ffffff';
          txtCtx.font = 'bold 64px monospace';
          txtCtx.textAlign = 'center';
          txtCtx.textBaseline = 'middle';
          txtCtx.fillText(letter, 64, 64);

          const txtTex = new THREE.CanvasTexture(txtCanvas);
          const spriteMat = new THREE.SpriteMaterial({
            map: txtTex,
            transparent: true,
            depthWrite: false
          });
          const sprite = new THREE.Sprite(spriteMat);
          sprite.name = 'labelSprite';
          sprite.scale.set(0.9, 0.9, 0.9);
          group.add(sprite);
        }

        // Apply animated positions, scale and opacity
        const pos3D = get3DCoords(node.x, node.y, index);
        group.position.copy(pos3D);
        group.scale.setScalar(node.scale);

        // Visibility
        group.visible = node.scale > 0.05;

        // Breathe light intensity animation
        const light = group.getObjectByName('nodeLight');
        if (light) {
          light.intensity = (2.2 + Math.sin(elapsed * 3.5 + index) * 0.8) * node.scale;
        }

        // 2. Synchronize branches (tubes connecting child to parent)
        const parentId = getParentId(node);
        if (parentId) {
          const parentNode = s.nodes[parentId];
          if (parentNode) {
            let branchMesh = branchMeshes[commit.id];
            
            // Re-generate branch tube mesh dynamically as nodes move
            const pStart = get3DCoords(parentNode.x, parentNode.y, index - 1);
            const pEnd = pos3D;

            // Generate winding branch curve
            const dir = new THREE.Vector3().subVectors(pEnd, pStart);
            const dist = dir.length();
            const points = [];
            
            const steps = 6;
            for (let k = 0; k <= steps; k++) {
              const t = k / steps;
              const pt = new THREE.Vector3().lerpVectors(pStart, pEnd, t);
              // Add natural organic bark wiggle
              if (k > 0 && k < steps) {
                const wiggleScale = dist * 0.08 * Math.sin(t * Math.PI);
                pt.x += Math.sin(t * Math.PI + index) * wiggleScale;
                pt.z += Math.cos(t * Math.PI + index) * wiggleScale;
              }
              points.push(pt);
            }

            const curve = new THREE.CatmullRomCurve3(points);
            const thickBase = Math.max(0.06, 0.22 - index * 0.015);
            const tubeGeo = new THREE.TubeGeometry(curve, 16, thickBase, 6, false);

            if (!branchMesh) {
              branchMesh = new THREE.Mesh(tubeGeo, branchMaterial);
              branchMesh.castShadow = true;
              branchMesh.receiveShadow = true;
              scene.add(branchMesh);
              branchMeshes[commit.id] = branchMesh;
            } else {
              branchMesh.geometry.dispose();
              branchMesh.geometry = tubeGeo;
            }

            // Sync visibility
            branchMesh.visible = node.active && node.scale > 0.05;

            // 3. Synchronize botanical leaf canopy clusters
            let leaves = leafClusters[commit.id];
            if (!leaves) {
              leaves = new THREE.Group();
              scene.add(leaves);
              leafClusters[commit.id] = leaves;

              // Generate 18 individual leaves clustered along the branch segment
              const leafCount = 18;
              for (let j = 0; j < leafCount; j++) {
                const leafMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), leafMaterial);
                
                // Position leaf along the curve
                const t = 0.2 + (j / leafCount) * 0.7;
                const pos = curve.getPointAt(t);
                leafMesh.position.copy(pos);

                // Add random cluster rotation
                leafMesh.rotation.set(
                  Math.random() * Math.PI * 2,
                  Math.random() * Math.PI * 2,
                  Math.random() * Math.PI * 2
                );

                // Leaves scale
                leafMesh.scale.setScalar(0.7 + Math.random() * 0.6);
                leaves.add(leafMesh);
              }
            } else {
              // Update leaf positions along branch
              const leafCount = leaves.children.length;
              for (let j = 0; j < leafCount; j++) {
                const leaf = leaves.children[j];
                const t = 0.2 + (j / leafCount) * 0.7;
                const pos = curve.getPointAt(t);
                leaf.position.copy(pos);
                // Subtle wind bobbing animation
                leaf.rotation.x += Math.sin(elapsed + j) * 0.008;
                leaf.rotation.y += Math.cos(elapsed + j) * 0.008;
              }
            }

            // Leaf visibility
            leaves.visible = node.active && node.scale > 0.05;
          }
        }
      });

      // 4. Cinematic focus on the current active node
      const activeCommit = sortedCommits[sliderVal];
      if (activeCommit) {
        const activeNode = s.nodes[activeCommit.id];
        if (activeNode) {
          const activePos3D = get3DCoords(activeNode.x, activeNode.y, sliderVal);
          // Interpolate camera target to selected node
          controls.target.lerp(activePos3D, 0.05);
        }
      }

      composer.render();
    };

    // Begin render frame loop
    const initialFrameId = requestAnimationFrame(animateScene);

    // Clean up
    return () => {
      cancelAnimationFrame(initialFrameId);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('click', handleCanvasClick);
      canvas.removeEventListener('mousemove', handleCanvasMouseMove);
      renderer.dispose();
      barkTexture.dispose();
      leafTexture.dispose();
      barkMaterial.dispose();
      leafMaterial.dispose();
      branchMaterial.dispose();
      Object.keys(commitGroups).forEach(id => {
        commitGroups[id].traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        });
      });
      Object.keys(branchMeshes).forEach(id => {
        branchMeshes[id].geometry.dispose();
      });
    };
  }, [sortedCommits, isSample]);

  // SVG Export Handler (Projects 3D node coordinates down for compatibility)
  const handleExportSVG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const nodeKeys = Object.keys(s.nodes);
    const activeNodes = nodeKeys.map(k => s.nodes[k]).filter(n => n.opacity >= 0.05);

    const cx = canvas.width / 2;
    const cy = canvas.height - 180;

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}">
      <defs>
        <radialGradient id="bg-grad" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stop-color="#030f05" />
          <stop offset="60%" stop-color="#010802" />
          <stop offset="100%" stop-color="#000300" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg-grad)" />
      <g transform="translate(${cx}, ${cy})">
    `;

    // Add Trunk
    const rootCommit = sortedCommits[0];
    const rootNode = rootCommit ? s.nodes[rootCommit.id] : null;
    if (rootNode) {
      const tx = rootNode.x, ty = rootNode.y;
      const trunkBot = 165;
      svgContent += `
        <!-- Trunk -->
        <path d="M ${tx - 36} ${trunkBot} L ${tx + 36} ${trunkBot} L ${tx} ${ty} Z" fill="rgba(34, 197, 94, 0.15)" />
        <path d="M ${tx - 14} ${trunkBot} L ${tx + 14} ${trunkBot} L ${tx} ${ty} Z" fill="rgba(34, 197, 94, 0.7)" />
        <line x1="${tx}" y1="${trunkBot}" x2="${tx}" y2="${ty}" stroke="#f0fdf4" stroke-width="3.5" />
      `;
    }

    // Add Vines
    activeNodes.forEach(node => {
      const parentId = getParentId(node);
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
        }
      }
    });

    // Add Nodes
    activeNodes.forEach(node => {
      const size = 11 * node.scale;
      
      const getLetterForNode = (n) => {
        if (isSample) {
          const sampleLetters = {
            'a4ab7e7e0ca303dbb9bcb7f3a7d3e0c31560220f': 'E', '7f59e2a6fad353762336cc6f237db8b56cc56db4': 'E',
            '00a68b543ed15bfc81d4a8af8daaf7ae12a3b90b': 'A', '57237f7376dcb1b7b7405e3fe522cc4f9cec5306': 'H',
            '5d8fef7c8c0e01a23aee467750937d6faca2da67': 'A', '621a52e486491d0727e057b8cdaa9321c1f90475': 'A',
            '00acb944a530d0825fc0299a73bddc687a7ca543': 'C', 'a4278361045e23bb0712f01e1c0e1d033bdb7118': 'F',
            '82da6dc2168560e7514e2fadb357f842d719412e': 'F', 'cbe13115cc5355ae3aac7fbc94e00b1ab533eabb': 'F'
          };
          return sampleLetters[n.commit.id] || 'E';
        }
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

      svgContent += `
        <!-- Node -->
        <circle cx="${node.x}" cy="${node.y}" r="${size * 2.2}" fill="rgba(57,255,20,0.12)" />
        <circle cx="${node.x}" cy="${node.y}" r="${size}" fill="#052e16" stroke="#ffffff" stroke-width="1.5" />
        <text x="${node.x}" y="${node.y + 0.5}" fill="#ffffff" font-size="${Math.max(9, Math.round(size * 1.15))}" font-family="'Inter', -apple-system, BlinkMacSystemFont, sans-serif" font-weight="bold" text-anchor="middle" dominant-baseline="central">${char}</text>
      `;
    });

    svgContent += `
      </g>
    </svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `yggdrasil-tree-3d-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleResetView = () => {
    const three = threeRef.current;
    if (three) {
      three.controls.reset();
      three.camera.position.set(0, 2, 16);
      three.controls.target.set(0, 0, 0);
    }
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
        borderRadius: '12px',
        boxShadow: 'inset 0 0 40px rgba(0, 0, 0, 0.8), 0 8px 32px rgba(0, 0, 0, 0.4)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        userSelect: 'none'
      }}
    >
      {/* Three.js canvas context */}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: hoveredNode ? 'pointer' : 'grab'
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
              zIndex: 100,
              pointerEvents: 'none',
              backdropFilter: 'blur(10px)',
              animation: 'fadeIn 0.15s ease-out'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '6px', marginBottom: '8px' }}>
              <span style={{ color: '#00f2fe', fontWeight: 'bold' }}>COMMIT DETAILS</span>
              <span style={{ opacity: 0.6, fontSize: '10px' }}>{shaVal}</span>
            </div>
            
            <div style={{ marginBottom: '6px' }}>
              <span style={{ color: '#d946ef', fontWeight: '500' }}>Author:</span>{' '}
              <span style={{ color: '#ffffff' }}>{authorVal}</span>
            </div>

            <div style={{ marginBottom: '6px' }}>
              <span style={{ color: '#f59e0b', fontWeight: '500' }}>Date:</span>{' '}
              <span style={{ color: '#e2e8f0', fontSize: '11px' }}>{dateVal}</span>
            </div>

            <div style={{ marginBottom: '8px', maxHeight: '48px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              <span style={{ color: '#10b981', fontWeight: '500' }}>Message:</span>{' '}
              <span style={{ color: '#f8fafc', fontStyle: 'italic' }}>"{hoveredNode.message}"</span>
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px', fontSize: '11px', color: '#a7f3d0' }}>
              🌳 {changedFilesCount} files modified in this revision
            </div>
          </div>
        );
      })()}

      {/* Floating HUD Leaf details overlay */}
      {hoveredLeaf && (
        <div
          className="floating-hud-overlay leaf-hud"
          style={{
            position: 'absolute',
            left: `${hudPos.x}px`,
            top: `${hudPos.y}px`,
            transform: 'translateY(-100%)',
            background: 'rgba(15, 23, 42, 0.94)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
            borderRadius: '8px',
            padding: '10px 14px',
            color: '#cbd5e1',
            width: '280px',
            fontFamily: 'ui-monospace, Consolas, monospace',
            fontSize: '11px',
            zIndex: 100,
            pointerEvents: 'none',
            backdropFilter: 'blur(10px)'
          }}
        >
          <div style={{ color: '#00f2fe', fontWeight: 'bold', marginBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' }}>
            FILE REVISION
          </div>
          <div><span style={{ opacity: 0.6 }}>Path:</span> <span style={{ color: '#ffffff' }}>{hoveredLeaf.file.path}</span></div>
          <div><span style={{ opacity: 0.6 }}>Status:</span> <span style={{ color: hoveredLeaf.file.status.startsWith('M') ? '#fbbf24' : (hoveredLeaf.file.status.startsWith('D') ? '#f87171' : '#4ade80') }}>{hoveredLeaf.file.status}</span></div>
          <div style={{ marginTop: '4px', fontSize: '9px', opacity: 0.5 }}>Commit: {hoveredLeaf.commitId.substring(0, 7)}</div>
        </div>
      )}

      {/* Left side custom vertical timeline slider */}
      <div className="timeline-slider-container" style={{
        position: 'absolute',
        left: '32px',
        top: '32px',
        bottom: '96px',
        width: '32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        zIndex: 10
      }}>
        <div
          className="timeline-track"
          ref={timelineRef}
          onMouseDown={(e) => {
            setIsDraggingSlider(true);
            updateSliderValFromEvent(e);
          }}
          style={{
            position: 'relative',
            width: '4px',
            height: '100%',
            background: 'linear-gradient(to bottom, rgba(255,255,255,0.05), rgba(255,255,255,0.25), rgba(255,255,255,0.05))',
            borderRadius: '2px',
            cursor: 'pointer'
          }}
        >
          {/* Timeline ticks */}
          {sortedCommits.map((commit, idx) => {
            const topPct = (idx / (sortedCommits.length - 1 || 1)) * 100;
            const isTickActive = idx <= sliderVal;
            const isTickHovered = hoveredTickIdx === idx;
            const layout = commitLayouts[commit.id] || { color: '#ffffff' };
            const color = layout.color || '#10b981';

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
          <span>0.5x</span>
          <span>10x</span>
        </div>
      </div>
    </div>
  );
}