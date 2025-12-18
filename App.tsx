import React, { useState, useEffect } from 'react';
import { useGeminiLive } from './hooks/useGeminiLive';
import { ConnectionState } from './types';
import { Visualizer } from './components/Visualizer';

const ACCESS_CODE = 'yashai';
const AUTH_STORAGE_KEY = 'yashai_auth_session';
const AUTH_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

const MainApp: React.FC = () => {
  const { connect, disconnect, connectionState, error, groundingMetadata, inputAnalyser, outputAnalyser, isMuted, toggleMute, videoRef, isVideoActive, videoSource, toggleVideo, toggleScreenShare, switchCamera, isUserSpeaking, isAiSpeaking, isThinkingMode, toggleThinkingMode } = useGeminiLive();

  const handleToggleConnect = () => {
    (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) ? disconnect() : connect();
  };

  const visualizerColor = '#3b82f6';
  const activeAnalyser = connectionState === ConnectionState.CONNECTED ? (isAiSpeaking ? outputAnalyser : (isUserSpeaking ? inputAnalyser : null)) : null;

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className={`absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-900/10 blur-[120px] transition-all duration-1000 ${connectionState === ConnectionState.CONNECTED ? 'opacity-80 scale-105' : 'opacity-30'}`} />
        <div className={`absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-900/10 blur-[120px] transition-all duration-1000 ${connectionState === ConnectionState.CONNECTED ? 'opacity-80 scale-105' : 'opacity-30'}`} />
      </div>

      <header className="absolute top-0 w-full p-6 z-20 flex justify-between items-center">
        <div className="flex items-center gap-3">
           <div className="relative">
             <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
             {connectionState === ConnectionState.CONNECTED && <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-75"></div>}
           </div>
           <span className="font-semibold tracking-wider text-sm text-slate-200/90 font-mono uppercase">YashAI Voice</span>
        </div>
        <div className="flex items-center gap-3">
            {isThinkingMode && (
                <div className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[9px] font-bold uppercase tracking-widest animate-pulse">Thinking Enabled</div>
            )}
            <div className={`px-3 py-1 rounded-full border border-white/5 bg-white/5 backdrop-blur-md text-[10px] font-medium tracking-widest uppercase ${connectionState === ConnectionState.CONNECTED ? 'text-blue-400 border-blue-500/20' : 'text-slate-500'}`}>
                {connectionState === ConnectionState.CONNECTED ? 'Live Session' : 'Standby'}
            </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center relative z-10 w-full max-w-4xl mx-auto px-4">
        <div className="relative w-full max-w-[420px] aspect-square flex items-center justify-center">
            <div className={`absolute inset-[-5%] rounded-full border transition-all duration-700 ${isVideoActive ? 'border-blue-500/20 opacity-100 scale-100' : 'border-transparent opacity-0 scale-95'}`}></div>
            
            <div className={`absolute inset-[15%] rounded-full overflow-hidden z-0 transition-all duration-700 ${isVideoActive ? 'opacity-100 scale-100 shadow-[0_0_50px_rgba(0,0,0,0.6)]' : 'opacity-0 scale-50'}`}>
                <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover opacity-60 mix-blend-lighten ${videoSource === 'screen' ? 'scale-110' : ''}`} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20"></div>
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-500/80 backdrop-blur-md px-2 py-0.5 rounded text-[8px] font-bold tracking-tighter animate-pulse">LIVE STREAM</div>
            </div>

            <div className="w-full h-full relative z-10 pointer-events-none drop-shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                <Visualizer analyser={activeAnalyser} isActive={connectionState === ConnectionState.CONNECTED} color={visualizerColor} />
            </div>
        </div>

        <div className="h-12 flex-shrink-0"></div>

        <div className="relative h-20 w-full flex justify-center items-center">
            <div className={`absolute flex items-center gap-2 p-2 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl transition-all duration-500 transform-gpu ${connectionState === ConnectionState.CONNECTED ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95 pointer-events-none'}`}>
                <button onClick={toggleMute} title="Mute Microphone" className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${isMuted ? 'bg-red-500/20 text-red-400' : 'hover:bg-white/10 text-slate-300'}`}>
                    {isMuted ? <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3zm-9 8l10-10" /></svg> : <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>}
                </button>
                <div className="w-px h-6 bg-white/10 mx-1"></div>
                <button onClick={toggleVideo} title="Share Camera" className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${videoSource === 'camera' ? 'bg-blue-500/20 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'hover:bg-white/10 text-slate-300'}`}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                </button>
                <button onClick={toggleScreenShare} title="Share Screen" className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${videoSource === 'screen' ? 'bg-blue-500/20 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'hover:bg-white/10 text-slate-300'}`}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13V5a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
                </button>
                <button onClick={toggleThinkingMode} title="Thinking Mode" className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${isThinkingMode ? 'bg-blue-500/20 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'hover:bg-white/10 text-slate-300'}`}>
                    <svg className={`w-5 h-5 ${isThinkingMode ? 'animate-pulse' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                </button>
                {videoSource === 'camera' && (
                  <button onClick={switchCamera} title="Switch Camera" className="w-12 h-12 rounded-xl flex items-center justify-center hover:bg-white/10 text-slate-300">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                )}
                <div className="w-px h-6 bg-white/10 mx-1"></div>
                 <button onClick={handleToggleConnect} title="End Session" className="w-12 h-12 rounded-xl flex items-center justify-center bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
                     <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <div className={`absolute flex flex-col items-center transition-all duration-500 ${connectionState !== ConnectionState.CONNECTED ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
                 <button onClick={handleToggleConnect} disabled={connectionState === ConnectionState.CONNECTING} className={`group flex items-center gap-3 px-8 py-4 rounded-full backdrop-blur-md border border-white/10 shadow-2xl ${connectionState === ConnectionState.ERROR ? 'bg-red-500/10 border-red-500/50' : 'bg-white/5 hover:bg-white/10 hover:scale-105'}`}>
                    <div className={`w-3 h-3 rounded-full ${connectionState === ConnectionState.CONNECTING ? 'bg-yellow-400 animate-pulse' : (connectionState === ConnectionState.ERROR ? 'bg-red-500' : 'bg-blue-400')}`}></div>
                    <span className="font-medium tracking-wide text-sm uppercase">{connectionState === ConnectionState.CONNECTING ? 'Connecting...' : 'Initialize'}</span>
                </button>
                {error && <p className="mt-4 text-[10px] text-red-400 bg-red-950/50 px-3 py-1 rounded-full border border-red-500/20">{error}</p>}
            </div>
        </div>
      </main>

      {groundingMetadata?.groundingChunks?.length > 0 && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-30">
              <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl animate-slide-up">
                  <div className="flex items-center gap-2 mb-3 text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      Reference Sources
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                      {groundingMetadata.groundingChunks.map((chunk, idx) => (
                          chunk.web?.uri && (
                              <a key={idx} href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 flex flex-col bg-white/5 border border-white/5 rounded-lg px-3 py-2 transition-all max-w-[180px] group">
                                  <span className="text-xs text-slate-200 font-medium truncate group-hover:text-blue-300">{chunk.web.title || "Source"}</span>
                                  <span className="text-[9px] text-slate-500 truncate">{new URL(chunk.web.uri).hostname}</span>
                              </a>
                          )
                      ))}
                  </div>
              </div>
          </div>
      )}
      <style>{`.animate-slide-up { animation: slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; } @keyframes slide-up { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } } .scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
};

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const { timestamp } = JSON.parse(stored);
        if (Date.now() - timestamp < AUTH_EXPIRY_MS) return true;
      }
    } catch (e) {}
    return false;
  });
  
  const [passcodeInput, setPasscodeInput] = useState('');
  const [authError, setAuthError] = useState('');

  if (!isAuthenticated) {
    return (
        <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center relative overflow-hidden">
            <div className="z-10 w-full max-w-sm p-8 bg-white/5 backdrop-blur-2xl rounded-3xl border border-white/10 shadow-2xl flex flex-col gap-6">
                <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 mx-auto mb-6 flex items-center justify-center">
                        <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.131A8 8 0 008 8m0 0a8 8 0 00-8 8c0 2.472.345 4.865.99 7.131M8 8a8 8 0 0016 0c0-2.472-.345-4.865-.99-7.131" /></svg>
                    </div>
                    <h1 className="text-xl font-medium mb-2">Security Check</h1>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); if (passcodeInput.toLowerCase().trim() === ACCESS_CODE) { setIsAuthenticated(true); localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ timestamp: Date.now() })); } else { setAuthError('Invalid credentials'); setPasscodeInput(''); } }} className="flex flex-col gap-3">
                    <input type="password" value={passcodeInput} onChange={(e) => setPasscodeInput(e.target.value)} placeholder="Passcode" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-center focus:border-blue-500/50 transition-all text-sm" autoFocus />
                    {authError && <p className="text-red-400 text-[10px] text-center">{authError}</p>}
                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-sm font-medium py-3.5 rounded-xl transition-all shadow-lg">Authenticate</button>
                </form>
            </div>
        </div>
    );
  }
  return <MainApp />;
};

export default App;