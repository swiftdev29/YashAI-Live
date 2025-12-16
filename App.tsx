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
    switchCamera
  } = useGeminiLive();

  const handleToggleConnect = () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      disconnect();
    } else {
      connect();
    }
  };

  const statusText = {
    [ConnectionState.DISCONNECTED]: 'Ready',
    [ConnectionState.CONNECTING]: 'Connecting...',
    [ConnectionState.CONNECTED]: 'Listening',
    [ConnectionState.ERROR]: 'Error',
  }[connectionState];

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans flex flex-col relative overflow-hidden selection:bg-blue-500/30">
      
      {/* Dynamic Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className={`absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-900/10 blur-[150px] transition-all duration-1000 ease-in-out transform-gpu will-change-[transform,opacity] ${connectionState === ConnectionState.CONNECTED ? 'opacity-100 scale-110' : 'opacity-40 scale-100'}`} />
        <div className={`absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-900/10 blur-[150px] transition-all duration-1000 ease-in-out transform-gpu will-change-[transform,opacity] ${connectionState === ConnectionState.CONNECTED ? 'opacity-100 scale-110' : 'opacity-40 scale-100'}`} />
      </div>

      <header className="absolute top-0 w-full p-6 z-20 flex justify-between items-center opacity-80">
        <div className="flex items-center gap-2">
           <div className="w-3 h-3 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"></div>
           <span className="font-semibold tracking-wide text-sm text-slate-300">YashAI Voice</span>
        </div>
        <div className="text-xs text-slate-500 font-mono">
            LIVE VOICE ASSISTANT
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center relative z-10 w-full max-w-4xl mx-auto px-4 gap-4">
        
        {/* Main Visualizer Area (Output) & Video Feed */}
        <div className="relative w-full max-w-[400px] aspect-square flex items-center justify-center">
            
            {/* Connection Status Indicator Ring */}
            <div className={`absolute inset-0 rounded-full border border-slate-800 transition-all duration-700 ${connectionState === ConnectionState.CONNECTED ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`}></div>
            <div className={`absolute inset-12 rounded-full border border-slate-800/50 transition-all duration-700 delay-100 ${connectionState === ConnectionState.CONNECTED ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`}></div>

            {/* Video Feed Layer */}
            <div className={`absolute inset-4 rounded-3xl overflow-hidden z-0 transition-all duration-500 ${isVideoActive ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
                <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className="w-full h-full object-cover opacity-80"
                />
            </div>

            {/* Visualizer Layer */}
            <div className="w-full h-full relative z-10 pointer-events-none">
                <Visualizer 
                  analyser={outputAnalyser} 
                  isActive={connectionState === ConnectionState.CONNECTED}
                  color={isVideoActive ? "#818cf8" : "#6366f1"}
                />
            </div>
        </div>

        {/* User Input Controls */}
        <div className={`relative flex flex-col items-center gap-2 transition-all duration-500 ${connectionState === ConnectionState.CONNECTED ? 'opacity-100 translate-y-0 h-24' : 'opacity-0 translate-y-4 h-0 overflow-hidden'}`}>
            
            <div className="flex items-center gap-4">
                {/* Mute Button */}
                <div className="flex flex-col items-center gap-1">
                    <button 
                      onClick={toggleMute}
                      className={`p-3 rounded-full transition-all duration-200 ${isMuted ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
                      title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                    >
                      {isMuted ? (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3zm-9 8l10-10" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                      )}
                    </button>
                    <span className="text-[9px] uppercase tracking-widest text-slate-600 font-semibold">Mic</span>
                </div>

                {/* Camera Button */}
                <div className="flex flex-col items-center gap-1">
                    <button 
                      onClick={toggleVideo}
                      className={`p-3 rounded-full transition-all duration-200 ${isVideoActive ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
                      title={isVideoActive ? "Turn Off Camera" : "Turn On Camera"}
                    >
                      {isVideoActive ? (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                        </svg>
                      )}
                    </button>
                    <span className="text-[9px] uppercase tracking-widest text-slate-600 font-semibold">Cam</span>
                </div>

                 {/* Flip Camera Button */}
                 <div className={`flex flex-col items-center gap-1 transition-all duration-300 ${isVideoActive ? 'opacity-100 scale-100' : 'opacity-0 scale-50 w-0 overflow-hidden'}`}>
                    <button 
                      onClick={switchCamera}
                      className="p-3 rounded-full transition-all duration-200 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                      title="Switch Camera"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                    <span className="text-[9px] uppercase tracking-widest text-slate-600 font-semibold">Flip</span>
                 </div>
            </div>

            <div className="w-full h-8 flex justify-center mt-1">
                 <div className="w-12 h-12 relative">
                    <Visualizer 
                        analyser={inputAnalyser} 
                        isActive={connectionState === ConnectionState.CONNECTED && !isMuted}
                        color={isMuted ? '#ef4444' : '#10b981'}
                    />
                 </div>
            </div>
        </div>

        {/* Action Area */}
        <div className="flex flex-col items-center gap-6 mt-4">
            
            {/* Error Banner */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2 rounded-lg text-sm backdrop-blur-sm">
                {error}
              </div>
            )}

            <button
                onClick={handleToggleConnect}
                disabled={connectionState === ConnectionState.CONNECTING}
                className={`
                  group relative flex items-center gap-3 px-8 py-4 rounded-full transition-all duration-300 backdrop-blur-md transform-gpu
                  ${connectionState === ConnectionState.CONNECTED 
                    ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30' 
                    : 'bg-white/5 hover:bg-white/10 text-white border border-white/10 hover:border-white/20 shadow-xl shadow-indigo-500/5'}
                `}
            >
                <div className={`w-2 h-2 rounded-full transition-colors ${connectionState === ConnectionState.CONNECTED ? 'bg-red-500 animate-pulse' : 'bg-indigo-400'}`}></div>
                <span className="font-medium tracking-wide text-sm uppercase">
                    {connectionState === ConnectionState.CONNECTED ? 'Disconnect' : 'Start Conversation'}
                </span>
                {connectionState === ConnectionState.CONNECTING && (
                    <div className="absolute right-4 w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                )}
            </button>
            
            <div className="h-6 text-xs text-slate-500 uppercase tracking-widest font-medium">
                {statusText}
            </div>
        </div>

      </main>

      {/* Grounding / Search Sources Panel */}
      {groundingMetadata && groundingMetadata.groundingChunks && groundingMetadata.groundingChunks.length > 0 && (
          <div 
            key={groundingMetadata.groundingChunks[0]?.web?.uri || Date.now()}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-30"
          >
              <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-xl p-4 shadow-2xl animate-slide-up transform-gpu">
                  <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      Sources
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                      {groundingMetadata.groundingChunks.map((chunk, idx) => (
                          chunk.web?.uri && (
                              <a 
                                  key={idx} 
                                  href={chunk.web.uri} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="flex-shrink-0 flex flex-col bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-3 transition-colors max-w-[200px]"
                              >
                                  <span className="text-xs text-slate-200 font-medium truncate w-full mb-1">
                                      {chunk.web.title || "Source"}
                                  </span>
                                  <span className="text-[10px] text-slate-500 truncate w-full">
                                      {new URL(chunk.web.uri).hostname}
                                  </span>
                              </a>
                          )
                      ))}
                  </div>
              </div>
          </div>
      )}

      {/* Custom Keyframes for Animations */}
      <style>{`
        @keyframes slide-up {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up {
          animation: slide-up 0.4s ease-out forwards;
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

// Authentication Wrapper
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
            {/* Background - Consistent with Main App */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-900/10 blur-[150px] animate-pulse" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-900/10 blur-[150px] animate-pulse" />
            </div>

            <div className="z-10 w-full max-w-md p-8 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl flex flex-col gap-6 transform-gpu transition-all">
                <div className="text-center">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-500 mx-auto mb-4 shadow-lg shadow-indigo-500/20"></div>
                    <h1 className="text-2xl font-bold tracking-tight text-white mb-2">YashAI Voice</h1>
                    <p className="text-slate-400 text-sm">Restricted Access</p>
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
                            setAuthError('Access denied. Invalid code.');
                            setPasscodeInput('');
                        }
                    }}
                    className="flex flex-col gap-4"
                >
                    <div>
                        <input 
                            type="password" 
                            value={passcodeInput}
                            onChange={(e) => setPasscodeInput(e.target.value)}
                            placeholder="Enter access code"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-3 text-center text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                            autoFocus
                        />
                        {authError && <p className="text-red-400 text-xs text-center mt-2">{authError}</p>}
                    </div>
                    
                    <button 
                        type="submit"
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-lg transition-colors shadow-lg shadow-indigo-500/20"
                    >
                        Enter
                    </button>
                </form>
            </div>
            
            <div className="absolute bottom-6 text-xs text-slate-600">
                Hint: {ACCESS_CODE}
            </div>
        </div>
    );
  }

  return <MainApp />;
};

export default App;