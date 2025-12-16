import React, { useState, useEffect } from 'react';
import { useGeminiLive } from './hooks/useGeminiLive';
import { ConnectionState } from './types';
import { Visualizer } from './components/Visualizer';

const ACCESS_CODE = 'yashai';
const AUTH_STORAGE_KEY = 'yashai_auth_session';
const AUTH_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Main Application Component (Protected)
const MainApp: React.FC = () => {
  const { 
    connect, 
    disconnect, 
    connectionState, 
    error,
    groundingMetadata,
    inputAnalyser,
    outputAnalyser,
    isMuted,
    toggleMute,
    videoRef,
    isVideoActive,
    toggleVideo,
    switchCamera,
    isUserSpeaking,
    isAiSpeaking
  } = useGeminiLive();

  const handleToggleConnect = () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      disconnect();
    } else {
      connect();
    }
  };

  // Visualizer Logic
  const visualizerColor = '#3b82f6'; // Tailwind Blue-500
  let activeAnalyser = null;

  if (connectionState === ConnectionState.CONNECTED) {
    if (isAiSpeaking) {
      activeAnalyser = outputAnalyser;
    } else if (isUserSpeaking) {
      activeAnalyser = inputAnalyser;
    } else {
      activeAnalyser = null; 
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans flex flex-col relative overflow-hidden selection:bg-blue-500/30">
      
      {/* Background Ambience */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className={`absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-900/10 blur-[120px] transition-all duration-1000 ease-in-out ${connectionState === ConnectionState.CONNECTED ? 'opacity-80 scale-105' : 'opacity-30 scale-100'}`} />
        <div className={`absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-900/10 blur-[120px] transition-all duration-1000 ease-in-out ${connectionState === ConnectionState.CONNECTED ? 'opacity-80 scale-105' : 'opacity-30 scale-100'}`} />
        {/* Subtle grid texture overlay */}
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150 mix-blend-overlay"></div>
      </div>

      <header className="absolute top-0 w-full p-6 z-20 flex justify-between items-center">
        <div className="flex items-center gap-3">
           <div className="relative">
             <div className="w-3 h-3 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-400 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
             {connectionState === ConnectionState.CONNECTED && (
               <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-75"></div>
             )}
           </div>
           <span className="font-semibold tracking-wider text-sm text-slate-200/90 font-mono uppercase">YashAI Voice</span>
        </div>
        
        <div className={`px-3 py-1 rounded-full border border-white/5 bg-white/5 backdrop-blur-md text-[10px] font-medium tracking-widest uppercase transition-colors duration-300 ${connectionState === ConnectionState.CONNECTED ? 'text-blue-400 border-blue-500/20' : 'text-slate-500 border-white/5'}`}>
            {connectionState === ConnectionState.CONNECTED ? 'Live Session' : 'Standby'}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center relative z-10 w-full max-w-4xl mx-auto px-4 min-h-[600px]">
        
        {/* Central Visualizer Area */}
        <div className="relative w-full max-w-[420px] aspect-square flex items-center justify-center">
            
            {/* Status Ring Animations */}
            <div className={`absolute inset-0 rounded-full border border-blue-500/20 transition-all duration-1000 ease-out ${connectionState === ConnectionState.CONNECTED ? 'scale-100 opacity-100' : 'scale-90 opacity-0'}`}></div>
            <div className={`absolute inset-0 rounded-full border border-indigo-500/10 transition-all duration-1000 ease-out delay-150 ${connectionState === ConnectionState.CONNECTED ? 'scale-110 opacity-100' : 'scale-95 opacity-0'}`}></div>

            {/* Video Feed Layer - Styled as a sleek underlay */}
            <div className={`absolute inset-[15%] rounded-full overflow-hidden z-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${isVideoActive ? 'opacity-100 scale-100 shadow-[0_0_40px_rgba(0,0,0,0.5)]' : 'opacity-0 scale-50'}`}>
                <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className="w-full h-full object-cover opacity-60 mix-blend-lighten"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20"></div>
            </div>

            {/* Visualizer Canvas */}
            <div className="w-full h-full relative z-10 pointer-events-none drop-shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                <Visualizer 
                  analyser={activeAnalyser} 
                  isActive={connectionState === ConnectionState.CONNECTED}
                  color={visualizerColor}
                />
            </div>
        </div>

        {/* Spacer for vertical separation */}
        <div className="h-12 flex-shrink-0"></div>

        {/* Unified Interaction Zone */}
        <div className="relative h-20 w-full flex justify-center items-center">
            
            {/* Connected Controls */}
            <div className={`
                absolute flex items-center gap-2 p-2 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl
                transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu
                ${connectionState === ConnectionState.CONNECTED ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto' : 'opacity-0 translate-y-4 scale-95 pointer-events-none'}
            `}>
                <button 
                    onClick={toggleMute}
                    className={`
                        w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200
                        ${isMuted 
                            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' 
                            : 'hover:bg-white/10 text-slate-300 hover:text-white'}
                    `}
                    title={isMuted ? "Unmute" : "Mute"}
                >
                    {isMuted ? (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3zm-9 8l10-10" /></svg>
                    ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                    )}
                </button>

                <div className="w-px h-6 bg-white/10 mx-1"></div>

                <button 
                    onClick={toggleVideo}
                    className={`
                        w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200
                        ${isVideoActive 
                            ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]' 
                            : 'hover:bg-white/10 text-slate-300 hover:text-white'}
                    `}
                    title="Camera"
                >
                    {isVideoActive ? (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3l18 18" /></svg>
                    )}
                </button>
                
                {/* Flip Camera */}
                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isVideoActive ? 'w-12 opacity-100' : 'w-0 opacity-0'}`}>
                     <button 
                        onClick={switchCamera}
                        className="w-12 h-12 rounded-xl flex items-center justify-center hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
                        title="Flip Camera"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                </div>

                <div className="w-px h-6 bg-white/10 mx-1"></div>

                 <button
                    onClick={handleToggleConnect}
                    className="w-12 h-12 rounded-xl flex items-center justify-center bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                    title="Disconnect"
                >
                     <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            {/* Start Button */}
            <div className={`
                absolute flex flex-col items-center
                transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu
                ${connectionState !== ConnectionState.CONNECTED ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto' : 'opacity-0 translate-y-4 scale-95 pointer-events-none'}
            `}>
                 <button
                    onClick={handleToggleConnect}
                    disabled={connectionState === ConnectionState.CONNECTING}
                    className={`
                      group relative flex items-center gap-3 px-8 py-4 rounded-full backdrop-blur-md border border-white/10 shadow-2xl
                      ${connectionState === ConnectionState.ERROR ? 'bg-red-500/10 border-red-500/50' : 'bg-white/5 hover:bg-white/10 hover:scale-105'}
                      transition-all duration-300 transform-gpu
                    `}
                >
                    <div className={`w-3 h-3 rounded-full ${connectionState === ConnectionState.CONNECTING ? 'bg-yellow-400 animate-pulse' : connectionState === ConnectionState.ERROR ? 'bg-red-500' : 'bg-blue-400 group-hover:shadow-[0_0_10px_rgba(96,165,250,0.6)]'} transition-shadow`}></div>
                    <span className="font-medium tracking-wide text-sm uppercase text-white">
                        {connectionState === ConnectionState.CONNECTING ? 'Connecting...' : connectionState === ConnectionState.ERROR ? 'Try Again' : 'Initialize'}
                    </span>
                </button>
                
                {error && (
                    <div className="mt-4 w-64 text-center absolute top-full left-1/2 -translate-x-1/2">
                        <p className="text-xs text-red-400 bg-red-950/50 px-3 py-1 rounded-full border border-red-500/20 whitespace-nowrap">{error}</p>
                    </div>
                )}
            </div>

        </div>

      </main>

      {/* Grounding / Search Sources Panel */}
      {groundingMetadata && groundingMetadata.groundingChunks && groundingMetadata.groundingChunks.length > 0 && (
          <div 
            key={groundingMetadata.groundingChunks[0]?.web?.uri || Date.now()}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-30"
          >
              <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl animate-slide-up transform-gpu">
                  <div className="flex items-center gap-2 mb-3 text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      Reference Sources
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                      {groundingMetadata.groundingChunks.map((chunk, idx) => (
                          chunk.web?.uri && (
                              <a 
                                  key={idx} 
                                  href={chunk.web.uri} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="flex-shrink-0 flex flex-col bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-lg px-3 py-2 transition-all max-w-[180px] group"
                              >
                                  <span className="text-xs text-slate-200 font-medium truncate w-full group-hover:text-blue-300 transition-colors">
                                      {chunk.web.title || "Source"}
                                  </span>
                                  <span className="text-[9px] text-slate-500 truncate w-full">
                                      {new URL(chunk.web.uri).hostname}
                                  </span>
                              </a>
                          )
                      ))}
                  </div>
              </div>
          </div>
      )}

      {/* Animation Styles */}
      <style>{`
        @keyframes slide-up {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up {
          animation: slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .scrollbar-hide::-webkit-scrollbar {
            display: none;
        }
        .scrollbar-hide {
            -ms-overflow-style: none;
            scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};

// Authentication Wrapper (Kept consistent with new style)
const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const { timestamp } = JSON.parse(stored);
        if (Date.now() - timestamp < AUTH_EXPIRY_MS) {
          return true;
        }
      }
    } catch (e) {
      console.error("Auth storage read error", e);
    }
    return false;
  });
  
  const [passcodeInput, setPasscodeInput] = useState('');
  const [authError, setAuthError] = useState('');

  if (!isAuthenticated) {
    return (
        <div className="min-h-screen bg-[#0A0A0A] text-white font-sans flex flex-col items-center justify-center relative overflow-hidden selection:bg-blue-500/30">
            {/* Background */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-900/10 blur-[120px] animate-pulse" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-900/10 blur-[120px] animate-pulse" />
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150 mix-blend-overlay"></div>
            </div>

            <div className="z-10 w-full max-w-sm p-8 bg-white/5 backdrop-blur-2xl rounded-3xl border border-white/10 shadow-2xl flex flex-col gap-6 transform-gpu transition-all">
                <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 mx-auto mb-6 shadow-lg shadow-blue-500/30 flex items-center justify-center">
                        <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.131A8 8 0 008 8m0 0a8 8 0 00-8 8c0 2.472.345 4.865.99 7.131M8 8a8 8 0 0016 0c0-2.472-.345-4.865-.99-7.131" /></svg>
                    </div>
                    <h1 className="text-xl font-medium tracking-tight text-white mb-2">Security Check</h1>
                    <p className="text-slate-400 text-xs">Please enter your access code to continue.</p>
                </div>

                <form 
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (passcodeInput.toLowerCase().trim() === ACCESS_CODE) {
                            setIsAuthenticated(true);
                            setAuthError('');
                            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
                              timestamp: Date.now()
                            }));
                        } else {
                            setAuthError('Invalid credentials');
                            setPasscodeInput('');
                        }
                    }}
                    className="flex flex-col gap-3"
                >
                    <div className="relative">
                        <input 
                            type="password" 
                            value={passcodeInput}
                            onChange={(e) => setPasscodeInput(e.target.value)}
                            placeholder="Passcode"
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-center text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all text-sm tracking-widest"
                            autoFocus
                        />
                    </div>
                    {authError && <p className="text-red-400 text-[10px] text-center font-medium bg-red-500/10 py-1 rounded-lg border border-red-500/10">{authError}</p>}
                    
                    <button 
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-3.5 rounded-xl transition-all shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 mt-2"
                    >
                        Authenticate
                    </button>
                </form>
            </div>
            
            <div className="absolute bottom-8 text-[10px] text-slate-700 font-mono">
                ID: {ACCESS_CODE.toUpperCase()}
            </div>
        </div>
    );
  }

  return <MainApp />;
};

export default App;