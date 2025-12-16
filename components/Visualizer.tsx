import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  color?: string;
}

export const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive, color = '#38bdf8' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        // Keep resolution 1:1 with CSS pixels for performance on high-DPI mobile screens
        // Increasing this to window.devicePixelRatio would look sharper but kill performance
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };
    
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // PERFORMANCE OPTIMIZATION:
    // Allocate buffers and lookup tables once, outside the render loop.
    // This prevents Garbage Collection (GC) stuttering on low-end devices.
    let dataArray: Uint8Array | null = null;
    let cosTable: Float32Array | null = null;
    let sinTable: Float32Array | null = null;
    let bufferLength = 0;

    if (analyser) {
      bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
      
      // Pre-calculate Sin/Cos tables to avoid expensive trig in the loop
      cosTable = new Float32Array(bufferLength);
      sinTable = new Float32Array(bufferLength);
      
      for (let i = 0; i < bufferLength; i++) {
        const angle = (Math.PI * 2 * i) / bufferLength;
        cosTable[i] = Math.cos(angle);
        sinTable[i] = Math.sin(angle);
      }
    }

    const render = () => {
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      // Base radius
      const radius = Math.min(width, height) / 4;

      ctx.clearRect(0, 0, width, height);

      // Idle State
      if (!isActive) {
         ctx.beginPath();
         ctx.arc(centerX, centerY, radius * 0.5, 0, 2 * Math.PI);
         ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
         ctx.lineWidth = 2;
         ctx.stroke();

         ctx.beginPath();
         ctx.arc(centerX, centerY, radius * 0.1, 0, 2 * Math.PI);
         ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
         ctx.fill();
         return;
      }
      
      if (analyser && dataArray && cosTable && sinTable) {
        analyser.getByteFrequencyData(dataArray);

        // Calculate average volume for pulse effect using a simple loop (faster than reduce)
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const pulse = (avg / 255);

        // --- Layer 1: Outer Glow ---
        // We limit the gradient creation to only when necessary, but it's cheap enough here.
        const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius * 2);
        gradient.addColorStop(0, `${color}20`); // Low opacity hex
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.globalAlpha = 0.3 + (pulse * 0.5);
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;

        // --- Layer 2: Frequency Rings ---
        ctx.beginPath();
        
        // Optimization: Stride by 2. We don't need 128 points for a small visualizer. 
        // 64 points is visually indistinguishable and 2x faster to draw.
        const stride = 2; 
        
        for (let i = 0; i < bufferLength; i += stride) {
          const value = dataArray[i];
          const offset = (value / 255) * (radius * 0.6);
          const r = radius + offset;
          
          // Use lookup tables
          const x = centerX + cosTable[i] * r;
          const y = centerY + sinTable[i] * r;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        
        // Close the path manually to ensure the last point connects to start
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Ring 2 (Smoothed Inner Circle)
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 0.8 + (pulse * 20), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // --- Layer 3: Core ---
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 0.4 + (pulse * 10), 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [analyser, isActive, color]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
};
