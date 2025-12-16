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
      if (!ctx || !analyser && isActive) {
        // Just draw a flat line or idle circle if active but no analyser yet
        // If not active, we clear
      }

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) / 4;

      ctx.clearRect(0, 0, width, height);

      if (!isActive) {
         // Draw idle state (a small static circle)
         ctx.beginPath();
         ctx.arc(centerX, centerY, radius * 0.5, 0, 2 * Math.PI);
         ctx.strokeStyle = '#334155';
         ctx.lineWidth = 2;
         ctx.stroke();
         return;
      }
      
      if (analyser) {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        // Draw Circular Waveform
        ctx.beginPath();
        // We wrap the frequency data around a circle
        // FFT size is 256, so bufferLength is 128.
        // We mirror it to make it look symmetrical (256 points total circle)
        
        for (let i = 0; i < bufferLength; i++) {
          const value = dataArray[i];
          const percent = value / 255;
          const heightOffset = radius * percent * 0.8; 
          const angle = (Math.PI * 2 * i) / bufferLength; 
          
          // Current radius at this angle
          const r = radius + heightOffset;
          
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        
        // Close the path nicely
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
        ctx.stroke();

        // Inner glow circle
        const avg = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
        const pulse = (avg / 255) * 20;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 0.8 + pulse, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.1 + (avg / 255) * 0.2;
        ctx.fill();
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

  return <canvas ref={canvasRef} className="w-full h-full block" />;
};