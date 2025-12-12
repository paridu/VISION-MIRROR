import React from 'react';
import MagicMirror from './components/MagicMirror';
import { Sparkles } from 'lucide-react';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="p-6 flex items-center justify-between border-b border-white/10 bg-black/50 backdrop-blur-sm z-50 sticky top-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-purple-400" />
          <h1 className="text-xl font-magic tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400">
            GEMINI MIRROR
          </h1>
        </div>
        <div className="text-xs text-gray-500 font-mono">
          POWERED BY GEMINI 2.5 FLASH
        </div>
      </header>
      
      <main className="flex-1 flex flex-col relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-purple-900/20 via-black to-black pointer-events-none" />
        <MagicMirror />
      </main>
    </div>
  );
};

export default App;
