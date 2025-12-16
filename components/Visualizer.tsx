import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  color?: string;
}

export const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive, color = '#3b82f6' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);
  
  // Use refs for persistent data
  const buffersRef = useRef<{
    dataArray: Uint8Array | null;
    bufferLength: number;
  }>({ dataArray: null, bufferLength: 0 });

  useEffect(() => {
    if (analyser) {
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      buffersRef.current = { dataArray, bufferLength };
    }
  }, [analyser]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const parent = canvas.parentElement;

    const resizeCanvas = () => {
      if (parent) {
        // Handle high DPI displays for crisp lines
        const dpr = window.devicePixelRatio || 1;
        canvas.width = parent.clientWidth * dpr;
        canvas.height = parent.clientHeight * dpr;
        ctx.scale(dpr, dpr);
        canvas.style.width = `${parent.clientWidth}px`;
        canvas.style.height = `${parent.clientHeight}px`;
      }
    };

    let observer: ResizeObserver | null = null;
    if (parent) {
       observer = new ResizeObserver(() => resizeCanvas());
       observer.observe(parent);
    }
    resizeCanvas();

    const render = () => {
      if (!ctx || !canvas) return;

      const width = parseFloat(canvas.style.width);
      const height = parseFloat(canvas.style.height);
      
      const centerX = width / 2;
      const centerY = height / 2;
      // Base radius of the inner circle
      const baseRadius = Math.min(width, height) / 6;

      ctx.clearRect(0, 0, width, height);

      // --- IDLE STATE (Disconnected) ---
      if (!isActive) {
         ctx.beginPath();
         ctx.arc(centerX, centerY, baseRadius, 0, 2 * Math.PI);
         ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
         ctx.lineWidth = 1;
         ctx.stroke();

         // Tiny breathing dot in center
         const time = Date.now() / 1000;
         const breathe = (Math.sin(time * 2) + 1) * 0.5;
         ctx.beginPath();
         ctx.arc(centerX, centerY, 2 + breathe * 2, 0, 2 * Math.PI);
         ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
         ctx.fill();
         
         animationFrameRef.current = requestAnimationFrame(render);
         return;
      }
      
      // --- ACTIVE STATE ---
      
      let pulse = 0;
      let dataArray = buffersRef.current.dataArray;
      
      // Get Audio Data
      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume for global pulse
        let sum = 0;
        const binCount = Math.floor(buffersRef.current.bufferLength * 0.7); // Focus on lower-mid freqs
        for (let i = 0; i < binCount; i++) {
          sum += dataArray[i];
        }
        pulse = (sum / binCount) / 255; 
      }
      
      // Artificial breathing for "Thinking" state (active but silent)
      const time = Date.now() / 1000;
      const breathing = (Math.sin(time * 2) + 1) * 0.15; // Slow breath
      
      // Effective visual magnitude
      const magnitude = Math.max(pulse, breathing);
      const isSilent = pulse < 0.05;

      // --- DRAWING ---

      // 1. Inner Glow Core
      const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.5, centerX, centerY, baseRadius * 2);
      gradient.addColorStop(0, `${color}40`); // Hex + opacity
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * 2 + (magnitude * 20), 0, Math.PI * 2);
      ctx.fill();

      // 2. Base Ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius + (magnitude * 5), 0, Math.PI * 2);
      ctx.strokeStyle = `${color}80`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 3. Radial Frequency Bars
      const bars = 64; // Number of bars
      const angleStep = (Math.PI * 2) / bars;
      
      ctx.lineCap = 'round';

      for (let i = 0; i < bars; i++) {
        let barHeight = 0;
        
        if (analyser && dataArray && !isSilent) {
             // Map bar index to frequency bin (logarithmic-ish mapping usually looks better, but linear is fine for this)
             // We have fewer bars than bins (usually 128 or 256 bins).
             // Simple mapping:
             const dataIndex = Math.floor((i / bars) * (buffersRef.current.bufferLength * 0.5));
             const value = dataArray[dataIndex] || 0;
             // Scale height
             barHeight = (value / 255) * (baseRadius * 1.5);
             // Minimum visibility
             barHeight = Math.max(barHeight, 4); 
        } else {
             // Idle/Breathing pattern for bars
             // Create a gentle wave effect around the circle
             const wave = Math.sin((i / bars) * Math.PI * 4 + time * 2);
             barHeight = 4 + (wave * 2) + (breathing * 10);
        }

        const angle = i * angleStep - (Math.PI / 2); // Start from top
        const currentRadius = baseRadius + 10 + (magnitude * 5); // Start slightly outside the ring

        const sx = centerX + Math.cos(angle) * currentRadius;
        const sy = centerY + Math.sin(angle) * currentRadius;
        const ex = centerX + Math.cos(angle) * (currentRadius + barHeight);
        const ey = centerY + Math.sin(angle) * (currentRadius + barHeight);

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = color;
        // Dynamic opacity based on height/loudness
        ctx.globalAlpha = isSilent ? 0.3 : 0.6 + (barHeight / (baseRadius * 1.5)) * 0.4;
        ctx.lineWidth = 3; // Thicker bars
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (observer) observer.disconnect();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [analyser, isActive, color]);

  return <canvas ref={canvasRef} className="w-full h-full block transform-gpu" />;
};