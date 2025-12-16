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

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        // 1:1 pixel mapping avoids expensive scaling on low-end GPUs
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };
    
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    let dataArray: Uint8Array | null = null;
    if (analyser) {
      dataArray = new Uint8Array(analyser.frequencyBinCount);
    }

    const render = () => {
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      
      // Calculate max radius to prevent clipping
      const maxRadius = Math.min(width, height) / 2;
      const baseRadius = maxRadius * 0.25;

      ctx.clearRect(0, 0, width, height);

      // Idle State: Breathing Dot
      if (!isActive) {
         const time = Date.now() / 1000;
         const breath = Math.sin(time * 2) * 0.1 + 1; // Gentle breath
         
         ctx.beginPath();
         ctx.arc(centerX, centerY, baseRadius * 0.5 * breath, 0, 2 * Math.PI);
         ctx.fillStyle = color;
         ctx.globalAlpha = 0.2;
         ctx.fill();
         ctx.globalAlpha = 1.0;
         
         animationFrameRef.current = requestAnimationFrame(render);
         return;
      }
      
      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);

        // Performance Optimization:
        // 1. Sample only the lower 70% of frequencies (speech is rarely in the top 30%)
        // 2. Stride by 4 to reduce loop iterations
        let sum = 0;
        let count = 0;
        const limit = Math.floor(dataArray.length * 0.7); 
        for (let i = 0; i < limit; i += 4) { 
          sum += dataArray[i];
          count++;
        }
        const avg = count > 0 ? sum / count : 0;
        
        // Normalize volume (0.0 to 1.0)
        // Squaring it creates a more dynamic "pop" effect for loud sounds
        const rawVolume = avg / 255;
        const volume = rawVolume * rawVolume; 

        // --- Simplified "Orb" Rendering (O(1) complexity) ---

        // 1. Glow (Fast fill with low opacity, no gradients)
        const glowRadius = baseRadius * 1.5 + (volume * baseRadius * 4);
        if (glowRadius > 0) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, Math.min(glowRadius, maxRadius), 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.15;
            ctx.fill();
        }

        // 2. Outer Ring (Stroke)
        const outerRadius = baseRadius * 1.2 + (volume * baseRadius * 2);
        ctx.beginPath();
        ctx.arc(centerX, centerY, Math.min(outerRadius, maxRadius * 0.9), 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6;
        ctx.stroke();

        // 3. Core (Solid Fill)
        const coreRadius = baseRadius + (volume * baseRadius);
        ctx.beginPath();
        ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.fill();

        // Reset settings
        ctx.globalAlpha = 1.0;
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

  return <canvas ref={canvasRef} className="w-full h-full block transform-gpu" />;
};