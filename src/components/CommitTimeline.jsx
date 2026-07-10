import React, { useState, useEffect, useRef } from 'react';

// Branch colors matching canvas
const BRANCH_COLORS = {
  main: '#00f2fe',
  feature: '#d946ef',
  hotfix: '#f59e0b',
};

export default function CommitTimeline({ commits, sliderVal, setSliderVal }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // Default 1x speed
  const activeNodeRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // Play timer loop
  useEffect(() => {
    let timer = null;
    if (isPlaying) {
      // 1x = 1500ms per step, 20x = 75ms per step
      const intervalDuration = Math.max(50, Math.round(1500 / playbackSpeed));
      timer = setInterval(() => {
        setSliderVal((prev) => {
          if (prev >= commits.length - 1) {
            setIsPlaying(false); // Stop at latest commit
            return prev;
          }
          return prev + 1;
        });
      }, intervalDuration);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, commits.length, setSliderVal, playbackSpeed]);

  // Auto-scroll timeline to keep active commit node centered
  useEffect(() => {
    if (activeNodeRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const el = activeNodeRef.current;
      const offsetLeft = el.offsetLeft;
      const halfWidth = container.clientWidth / 2;
      container.scrollTo({
        left: offsetLeft - halfWidth + el.clientWidth / 2,
        behavior: 'smooth'
      });
    }
  }, [sliderVal]);

  if (!commits || commits.length === 0) return null;

  // Active or hovered commit for the HUD display
  const displayIdx = hoveredIdx !== null ? hoveredIdx : sliderVal;
  const displayCommit = commits[displayIdx] || commits[0];

  let displayColor = BRANCH_COLORS.main;
  if (displayCommit.parentIds.length > 1) {
    displayColor = BRANCH_COLORS.feature;
  } else if (displayCommit.message.toLowerCase().includes('fix') || displayCommit.message.toLowerCase().includes('bug')) {
    displayColor = BRANCH_COLORS.hotfix;
  } else if (displayIdx % 3 === 1) {
    displayColor = BRANCH_COLORS.feature;
  } else if (displayIdx % 5 === 4) {
    displayColor = BRANCH_COLORS.hotfix;
  }

  const dateStr = new Date(displayCommit.timestamp * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div className="visual-timeline-panel">
      {/* HUD Header for commit metadata */}
      <div className="timeline-hud-header">
        <div className="hud-meta-left">
          <div className="hud-title-badge">
            {hoveredIdx !== null ? 'PREVIEWING TIME' : 'CURRENT TIME'}
          </div>
          <div className="hud-main-desc">
            <span className="hud-index">Commit {displayIdx + 1} of {commits.length}</span>
            <span className="hud-hash" style={{ color: displayColor }}>
              [{displayCommit.id.substring(0, 7)}]
            </span>
          </div>
        </div>
        
        <div className="hud-meta-right">
          <div className="hud-message" title={displayCommit.message}>
            {displayCommit.message}
          </div>
          <div className="hud-details">
            by <span className="hud-author">{displayCommit.author}</span> • <span className="hud-date">{dateStr}</span>
          </div>
        </div>
      </div>

      <div className="timeline-row-container">
        {/* Autoplay controller */}
        <div className="timeline-controls" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button 
            className="play-from-start-btn"
            onClick={() => {
              setSliderVal(0);
              setIsPlaying(true);
            }}
            title="Restart and Play from Start"
          >
            ⏮ Restart & Play
          </button>
          <button 
            className={`play-pause-btn ${isPlaying ? 'playing' : ''}`}
            onClick={() => setIsPlaying(!isPlaying)}
            title={isPlaying ? 'Pause Replay' : 'Replay Git History'}
          >
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
          
          <div className="speed-adjuster-container">
            <span className="speed-label">{playbackSpeed}x</span>
            <input 
              type="range"
              min="1"
              max="20"
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(parseInt(e.target.value))}
              className="speed-range-slider"
              title="Adjust playback speed"
            />
          </div>
        </div>

        {/* Scrollable Timeline Axis */}
        <div className="timeline-scroll-wrapper" ref={scrollContainerRef}>
          <div 
            className="timeline-track-axis" 
            style={{ width: `${Math.max(commits.length * 40 + 80, 500)}px` }}
          >
            {/* Connector Line */}
            <div className="timeline-axis-line"></div>

            {/* Render commit nodes along track */}
            {commits.map((commit, idx) => {
              const isActive = idx === sliderVal;
              const isHovered = idx === hoveredIdx;
              
              // Assign dot color based on branch type
              let color = BRANCH_COLORS.main;
              if (commit.parentIds.length > 1) {
                color = BRANCH_COLORS.feature;
              } else if (commit.message.toLowerCase().includes('fix') || commit.message.toLowerCase().includes('bug')) {
                color = BRANCH_COLORS.hotfix;
              } else if (idx % 3 === 1) {
                color = BRANCH_COLORS.feature;
              } else if (idx % 5 === 4) {
                color = BRANCH_COLORS.hotfix;
              }

              return (
                <div 
                  key={commit.id} 
                  ref={isActive ? activeNodeRef : null}
                  className={`timeline-commit-tick ${isActive ? 'active' : ''} ${isHovered ? 'hovered' : ''}`}
                  style={{ 
                    left: `${idx * 40 + 40}px`,
                  }}
                  onClick={() => setSliderVal(idx)}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  {/* Visual Commit Dot */}
                  <div 
                    className="commit-dot"
                    style={{ 
                      backgroundColor: color,
                      boxShadow: isActive ? `0 0 12px ${color}, 0 0 0 2px #fff` : `0 0 6px ${color}88`
                    }}
                  >
                    {isActive && <div className="pulse-ring" style={{ borderColor: color }}></div>}
                  </div>

                  {/* Subtitle label showing index */}
                  <span className="tick-index">{idx + 1}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
