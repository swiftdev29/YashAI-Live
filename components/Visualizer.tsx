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

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };
    
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

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
      
      if (analyser) {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        // Calculate average volume for pulse effect
        const avg = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
        const pulse = (avg / 255);

        // --- Layer 1: Outer Glow ---
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
        // We'll draw 2 rings with different sensitivities

        // Ring 1 (Bass/Low Mids)
        ctx.beginPath();
        for (let i = 0; i < bufferLength; i++) {
          // Wrap around circle
          const angle = (Math.PI * 2 * i) / bufferLength;
          // Scale based on data
          const value = dataArray[i];
          const offset = (value / 255) * (radius * 0.6);
          
          const r = radius + offset;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
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