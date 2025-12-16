import React, { useState, useEffect } from 'react';
import { useGeminiLive } from './hooks/useGeminiLive';
import { ConnectionState } from './types';
import { Visualizer } from './components/Visualizer';

const App: React.FC = () => {
  const { 
    connect, 
    disconnect, 
    connectionState, 
    error,
    inputAnalyser,
    outputAnalyser
  } = useGeminiLive();

  const [isMicMuted, setIsMicMuted] = useState(false);

  const handleToggleConnect = () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      disconnect();
    } else {
      connect();
    }
  };

  const statusColor = {
    [ConnectionState.DISCONNECTED]: 'text-slate-400',
    [ConnectionState.CONNECTING]: 'text-yellow-400',
    [ConnectionState.CONNECTED]: 'text-emerald-400',
    [ConnectionState.ERROR]: 'text-red-400',
  }[connectionState];

  const statusText = {
    [ConnectionState.DISCONNECTED]: 'Ready to Connect',
    [ConnectionState.CONNECTING]: 'Establishing Uplink...',
    [ConnectionState.CONNECTED]: 'Live Session Active',
    [ConnectionState.ERROR]: 'Connection Failed',
  }[connectionState];

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center relative overflow-hidden">
      
      {/* Background Ambience */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600/10 blur-[120px]" />
      </div>

      <main className="relative z-10 w-full max-w-2xl px-6 flex flex-col items-center gap-12">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white">
            YashAI <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">Live</span>
          </h1>
          <p className="text-slate-400 font-medium tracking-wide">
            NATIVE AUDIO EXPERIENCE
          </p>
        </div>

        {/* Visualizer Container */}
        <div className="w-full aspect-square max-w-md relative flex items-center justify-center">
          
          {/* Output Visualizer (The AI) - Blue/Purple */}
          <div className="absolute inset-0 z-10">
             <Visualizer 
                analyser={outputAnalyser} 
                isActive={connectionState === ConnectionState.CONNECTED}
                color="#818cf8"
             />
          </div>

          {/* Input Visualizer (The User) - Subtle overlay or ring? 
              For simplicity and aesthetics, let's just show the Output when AI talks, 
              and maybe a smaller indication when User talks. 
              Actually, merging them onto one canvas or layering them is tricky without distinct separation.
              Let's create a secondary ring for the user.
          */}
          
        </div>

        {/* Status & Error */}
        <div className="h-8 flex items-center justify-center">
          {error ? (
            <span className="text-red-400 bg-red-900/20 px-4 py-1 rounded-full text-sm font-semibold border border-red-500/20">
              {error}
            </span>
          ) : (
            <div className={`flex items-center gap-2 ${statusColor} bg-slate-900/50 px-4 py-1.5 rounded-full border border-slate-800`}>
              <span className={`w-2 h-2 rounded-full ${connectionState === ConnectionState.CONNECTED ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              <span className="text-sm font-medium uppercase tracking-wider">{statusText}</span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-6">
          <button
            onClick={handleToggleConnect}
            disabled={connectionState === ConnectionState.CONNECTING}
            className={`
              relative group flex items-center justify-center w-20 h-20 rounded-full transition-all duration-300
              ${connectionState === ConnectionState.CONNECTED 
                ? 'bg-red-500/10 hover:bg-red-500/20 border-red-500 text-red-400' 
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'}
              border-2 ${connectionState === ConnectionState.CONNECTED ? 'border-red-500' : 'border-transparent'}
            `}
          >
             {/* Icon */}
             {connectionState === ConnectionState.CONNECTED ? (
               <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
             ) : (
               <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
             )}
             
             {/* Ring Animation when connecting */}
             {connectionState === ConnectionState.CONNECTING && (
               <div className="absolute inset-[-4px] rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
             )}
          </button>
        </div>

        <p className="text-slate-500 text-xs text-center max-w-xs leading-relaxed">
          Ensure your volume is up and microphone access is granted.
          <br />
          Powered by YashAI.
        </p>
      </main>
    </div>
  );
};

export default App;