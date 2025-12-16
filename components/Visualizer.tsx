import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  color?: string;
}

export const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive, color = '#38bdf8' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);
  
  // Use refs for persistent data to avoid re-allocation on re-renders
  const buffersRef = useRef<{
    dataArray: Uint8Array | null;
    cosTable: Float32Array | null;
    sinTable: Float32Array | null;
    bufferLength: number;
  }>({ dataArray: null, cosTable: null, sinTable: null, bufferLength: 0 });

  // Initialize buffers only when analyser changes
  useEffect(() => {
    if (analyser) {
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const cosTable = new Float32Array(bufferLength);
      const sinTable = new Float32Array(bufferLength);
      
      for (let i = 0; i < bufferLength; i++) {
        const angle = (Math.PI * 2 * i) / bufferLength;
        cosTable[i] = Math.cos(angle);
        sinTable[i] = Math.sin(angle);
      }

      buffersRef.current = { dataArray, cosTable, sinTable, bufferLength };
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
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };

    let observer: ResizeObserver | null = null;
    if (parent) {
       observer = new ResizeObserver(() => {
         resizeCanvas();
       });
       observer.observe(parent);
    }
    resizeCanvas();

    const render = () => {
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) / 4;

      ctx.clearRect(0, 0, width, height);

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
         
         animationFrameRef.current = requestAnimationFrame(render);
         return;
      }
      
      const { dataArray, cosTable, sinTable, bufferLength } = buffersRef.current;

      if (analyser && dataArray && cosTable && sinTable) {
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const pulse = (avg / 255);

        // Layer 1: Glow
        const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius * 2);
        gradient.addColorStop(0, `${color}40`); 
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.globalAlpha = 0.3 + (pulse * 0.5);
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;

        // Layer 2: Frequency Ring
        ctx.beginPath();
        const stride = 2; 
        for (let i = 0; i < bufferLength; i += stride) {
          const value = dataArray[i];
          const offset = (value / 255) * (radius * 0.6);
          const r = radius + offset;
          
          const x = centerX + cosTable[i] * r;
          const y = centerY + sinTable[i] * r;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Layer 3: Inner Ring
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 0.8 + (pulse * 20), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Layer 4: Core
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 0.4 + (pulse * 10), 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
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