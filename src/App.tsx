import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, Crop, FileText, Lock, Globe, Sparkles, Code, BarChart, BookOpen, PenTool } from 'lucide-react';

import bgImg from './assets/bg.png';
import frustratedImg from './assets/frustrated.png';
import browserImg from './assets/browser.png';
import privacyImg from './assets/privacy.png';

const SCENE_DURATIONS = [
  3500, // Scene 1 - Hook
  5000, // Scene 2 - Problem
  6500, // Scene 3 - Capture
  8000, // Scene 4 - Analysis
  6000, // Scene 5 - Agents
  4500, // Scene 6 - Privacy
  5000  // Scene 7 - Closing
];

export default function App() {
  const [currentScene, setCurrentScene] = useState(0);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    const nextScene = () => {
      setCurrentScene((prev) => (prev + 1) % SCENE_DURATIONS.length);
    };

    timeout = setTimeout(nextScene, SCENE_DURATIONS[currentScene]);
    return () => clearTimeout(timeout);
  }, [currentScene]);

  return (
    <div className="w-full h-screen bg-[var(--st-bg-app)] overflow-hidden text-white font-body relative">
      {/* Persistent Background - subtle animated gradient */}
      <div className="absolute inset-0 z-0" style={{
        background: 'radial-gradient(ellipse at 50% 50%, #0d1b2a 0%, #0a0a1a 60%, #050510 100%)'
      }} />
      <motion.div 
        className="absolute inset-0 z-[1] opacity-10"
        animate={{
          scale: [1, 1.05, 1],
          rotate: [0, 1, 0]
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
      >
        <img src={bgImg} alt="background" className="w-full h-full object-cover mix-blend-screen" />
      </motion.div>
      
      {/* Floating Orbs */}
      <motion.div
        className="absolute top-[60%] left-[10%] w-[30vw] h-[30vw] rounded-full bg-[var(--st-accent)] blur-[120px] mix-blend-screen z-[2]"
        animate={{
          x: currentScene % 2 === 0 ? '5vw' : '-5vw',
          y: currentScene % 3 === 0 ? '5vh' : '-5vh',
          opacity: currentScene === 1 ? 0.05 : 0.1,
          scale: currentScene === 6 ? 1.5 : 1
        }}
        transition={{ duration: 3, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute top-[10%] right-[10%] w-[25vw] h-[25vw] rounded-full bg-blue-600 blur-[100px] mix-blend-screen z-[2]"
        animate={{
          x: currentScene % 2 === 0 ? '-5vw' : '5vw',
          opacity: currentScene === 1 ? 0.05 : 0.1
        }}
        transition={{ duration: 4, ease: "easeInOut" }}
      />

      <div className="absolute inset-0 z-[10] perspective-1000">
        <AnimatePresence mode="wait">
          {currentScene === 0 && <Scene1Hook key="scene1" />}
          {currentScene === 1 && <Scene2Problem key="scene2" />}
          {currentScene === 2 && <Scene3Capture key="scene3" />}
          {currentScene === 3 && <Scene4Analysis key="scene4" />}
          {currentScene === 4 && <Scene5Agents key="scene5" />}
          {currentScene === 5 && <Scene6Privacy key="scene6" />}
          {currentScene === 6 && <Scene7Closing key="scene7" />}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Scene 1: Hook
function Scene1Hook() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center text-center"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: "blur(10px)" }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.h2 
        className="text-[3.5vw] font-display text-white/80 mb-[4vh] tracking-widest uppercase"
        style={{ textShadow: '0 0 40px rgba(0,217,255,0.3)' }}
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.8 }}
      >
        What if your screen could talk back?
      </motion.h2>

      <motion.div 
        className="flex items-center gap-6 text-[10vw] font-display font-bold leading-none"
        initial={{ scale: 0.5, opacity: 0, rotateX: 45 }}
        animate={{ scale: 1, opacity: 1, rotateX: 0 }}
        transition={{ delay: 0.5, type: "spring", stiffness: 100, damping: 20 }}
      >
        <span className="text-white" style={{ textShadow: '0 0 30px rgba(255,255,255,0.3)' }}>SNAP</span>
        <span className="text-[var(--st-accent)]" style={{ textShadow: '0 0 60px rgba(0,217,255,0.8), 0 0 120px rgba(0,217,255,0.4)' }}>TO AI</span>
        <motion.span 
          className="text-[7vw]"
          animate={{ rotate: [0, 15, -15, 0] }}
          transition={{ delay: 1.5, duration: 0.5, ease: "easeInOut" }}
        >
          📸
        </motion.span>
      </motion.div>

      <motion.p 
        className="mt-[6vh] text-[2.8vw] font-display tracking-widest text-white"
        style={{ textShadow: '0 0 30px rgba(0,217,255,0.5)' }}
        initial={{ clipPath: "polygon(0 0, 0 0, 0 100%, 0% 100%)" }}
        animate={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 0% 100%)" }}
        transition={{ delay: 1.5, duration: 1, ease: "circOut" }}
      >
        SNAP IT. SNIP IT. FLIP IT TO AI.
      </motion.p>
    </motion.div>
  );
}

// Scene 2: Problem
function Scene2Problem() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 0, clipPath: "circle(0% at 50% 50%)" }}
      animate={{ opacity: 1, clipPath: "circle(150% at 50% 50%)" }}
      exit={{ opacity: 0, x: "-100vw" }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute inset-0 z-0">
        <motion.img 
          src={frustratedImg} 
          alt="Frustrated"
          className="w-full h-full object-cover opacity-30"
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
          transition={{ duration: 5 }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a1a] via-transparent to-[#0a0a1a]" />
      </div>

      <motion.div className="z-10 text-center">
        <motion.h2 
          className="text-[6vw] font-display font-bold uppercase tracking-tight text-white"
          style={{ textShadow: '0 0 40px rgba(0,0,0,0.8), 0 0 80px rgba(0,217,255,0.3)' }}
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
        >
          Stop typing<br/>what you see.
        </motion.h2>
      </motion.div>

      {/* Scattered screens */}
      {[...Array(5)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute glass p-4 rounded-xl border border-white/10 w-[20vw] h-[15vw] z-20"
          style={{
            left: `${10 + (i * 15)}vw`,
            top: `${20 + (i % 2 === 0 ? 40 : 10)}vh`,
          }}
          initial={{ opacity: 0, scale: 0, rotate: -20 + Math.random() * 40 }}
          animate={{ 
            opacity: 0.6, 
            scale: 1, 
            rotate: -10 + Math.random() * 20,
            y: [0, -20, 0]
          }}
          transition={{ 
            opacity: { delay: 1 + i * 0.2 },
            scale: { delay: 1 + i * 0.2, type: "spring" },
            y: { duration: 3 + Math.random(), repeat: Infinity, ease: "easeInOut" }
          }}
        >
          <div className="w-full h-2 bg-white/20 rounded mb-2 w-1/2" />
          <div className="w-full h-2 bg-white/10 rounded mb-2" />
          <div className="w-full h-2 bg-white/10 rounded mb-2 w-3/4" />
        </motion.div>
      ))}
    </motion.div>
  );
}

// Scene 3: Capture
function Scene3Capture() {
  const modes = [
    { icon: <Camera size="4vw" />, title: "SNAP", desc: "Capture your viewport" },
    { icon: <Crop size="4vw" />, title: "SNIP", desc: "Select any region" },
    { icon: <FileText size="4vw" />, title: "FULL PAGE", desc: "Scroll & stitch automatically" }
  ];

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center p-[5vw]"
      initial={{ x: "100vw" }}
      animate={{ x: 0 }}
      exit={{ scale: 0.8, opacity: 0, filter: "blur(20px)" }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex flex-col gap-[6vh] w-1/2">
        {modes.map((mode, i) => (
          <motion.div 
            key={i}
            className="flex items-center gap-[2vw] glass p-[2vw] rounded-2xl border-l-4 border-l-[var(--st-accent)]"
            initial={{ x: -50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.5 + i * 0.4, type: "spring", stiffness: 100 }}
          >
            <div className="text-[var(--st-accent)]">{mode.icon}</div>
            <div>
              <h3 className="text-[2.5vw] font-display font-bold">{mode.title}</h3>
              <p className="text-[1.5vw] text-gray-400">{mode.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="w-1/2 relative h-full flex items-center justify-center">
        <motion.img 
          src={browserImg} 
          alt="Browser"
          className="w-full object-contain drop-shadow-2xl"
          initial={{ opacity: 0, scale: 0.9, rotateY: 30 }}
          animate={{ opacity: 1, scale: 1, rotateY: 0 }}
          transition={{ delay: 1, duration: 1 }}
        />
        <div className="absolute top-[20%] right-[10%] flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            <motion.div 
              key={i}
              className="w-[10vw] h-[6vw] glass border border-[#00d9ff]/50 rounded-lg overflow-hidden relative"
              initial={{ x: 100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 2 + i * 0.3, type: "spring" }}
            >
              <div className="absolute inset-0 bg-[var(--st-accent)]/20 animate-pulse" />
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// Scene 4: Analysis
function Scene4Analysis() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center p-[5vw]"
      initial={{ opacity: 0, scale: 1.2 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: "-100vh" }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.h2 
        className="text-[4.5vw] font-display font-bold uppercase text-center mb-[4vh] text-white"
        style={{ textShadow: '0 0 40px rgba(0,0,0,0.5)' }}
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        Instant AI analysis<br/>
        <span className="text-[var(--st-accent)]" style={{ textShadow: '0 0 40px rgba(0,217,255,0.6)' }}>powered by Google Gemini</span>
      </motion.h2>

      <div className="w-[70vw] h-[50vh] glass rounded-2xl p-[2vw] relative overflow-hidden flex flex-col">
        <motion.div 
          className="w-full h-2 bg-[var(--st-accent)] absolute top-0 left-0"
          initial={{ scaleX: 0, originX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 6, ease: "linear" }}
        />
        
        <div className="flex gap-4 h-full">
          <motion.div 
            className="w-1/3 h-full bg-white/5 rounded-xl border border-white/10 relative overflow-hidden"
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 1 }}
          >
             <div className="absolute inset-0 bg-gradient-to-b from-[#00d9ff]/10 to-transparent" />
             <div className="p-4 flex flex-col gap-2">
               <div className="w-3/4 h-3 bg-white/20 rounded" />
               <div className="w-full h-3 bg-white/20 rounded" />
               <div className="w-5/6 h-3 bg-white/20 rounded" />
             </div>
          </motion.div>
          
          <div className="w-2/3 h-full flex flex-col gap-4">
            <motion.div 
              className="text-[1.5vw] font-mono text-cyan-200"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2 }}
            >
              <TypewriterText text="Analyzing screenshot content..." delay={2000} />
            </motion.div>
            <motion.div 
              className="glass flex-1 rounded-xl p-6 font-mono text-[1.2vw] text-gray-300"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 3.5 }}
            >
              <TypewriterText text="const analysis = {\n  type: 'React Component',\n  complexity: 'Medium',\n  suggestions: ['Extract inline styles', 'Memoize callback']\n};" delay={3500} />
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// Scene 5: Agents
function Scene5Agents() {
  const agents = [
    { icon: <Code size="3vw" />, name: "Coder", color: "from-blue-500 to-cyan-400" },
    { icon: <BarChart size="3vw" />, name: "Analyst", color: "from-purple-500 to-pink-500" },
    { icon: <BookOpen size="3vw" />, name: "Tutor", color: "from-emerald-400 to-teal-500" },
    { icon: <PenTool size="3vw" />, name: "Writer", color: "from-orange-400 to-red-500" }
  ];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center p-[5vw]"
      initial={{ y: "100vh", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ scale: 2, opacity: 0 }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.h2 
        className="text-[6vw] font-display font-bold uppercase text-center text-white"
        style={{ textShadow: '0 0 40px rgba(0,0,0,0.5)' }}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        Build your own<br/>
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00d9ff] to-purple-400" style={{ filter: 'drop-shadow(0 0 20px rgba(0,217,255,0.5))' }}>AI Agents</span>
      </motion.h2>

      <motion.p 
        className="text-[2vw] text-gray-400 mt-[2vh] mb-[8vh] font-display"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
      >
        Customize prompts for how YOU work
      </motion.p>

      <div className="flex gap-[3vw]">
        {agents.map((agent, i) => (
          <motion.div
            key={i}
            className={`w-[15vw] h-[18vw] rounded-2xl flex flex-col items-center justify-center gap-[2vh] relative overflow-hidden group`}
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 1 + i * 0.15, type: "spring", stiffness: 100 }}
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${agent.color} opacity-20`} />
            <div className={`absolute inset-0 bg-gradient-to-br ${agent.color} opacity-0 mix-blend-overlay transition-opacity duration-300`} />
            <div className="glass absolute inset-[1px] rounded-[15px] z-10" />
            
            <div className="z-20 p-4 rounded-full bg-white/10 border border-white/20">
              {agent.icon}
            </div>
            <span className="z-20 font-display font-bold text-[2vw]">{agent.name}</span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// Scene 6: Privacy
function Scene6Privacy() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center p-[5vw] overflow-hidden"
      initial={{ clipPath: "circle(0% at 50% 50%)" }}
      animate={{ clipPath: "circle(150% at 50% 50%)" }}
      exit={{ opacity: 0, filter: "blur(20px)" }}
      transition={{ duration: 1.2, ease: "easeInOut" }}
    >
      <motion.div 
        className="w-[15vw] h-[15vw] relative mb-[4vh]"
        initial={{ scale: 0, rotateY: -180 }}
        animate={{ scale: 1, rotateY: 0 }}
        transition={{ delay: 0.5, type: "spring", stiffness: 100 }}
      >
        <img src={privacyImg} alt="Privacy" className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(0,217,255,0.5)]" />
      </motion.div>

      <motion.h2 
        className="text-[5vw] font-display font-bold uppercase text-center leading-tight text-white"
        style={{ textShadow: '0 0 40px rgba(0,0,0,0.5)' }}
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1 }}
      >
        Your data stays<br/>
        <span className="text-[var(--st-accent)]" style={{ textShadow: '0 0 40px rgba(0,217,255,0.6)' }}>in your browser</span>
      </motion.h2>

      <motion.div 
        className="flex items-center gap-[2vw] mt-[6vh] text-[2vw] font-display text-gray-400"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
      >
        <div className="glass px-6 py-3 rounded-full">Browser</div>
        <motion.div 
          className="h-[2px] w-[10vw] bg-gradient-to-r from-transparent via-[#00d9ff] to-transparent relative"
        >
          <motion.div 
            className="absolute top-1/2 left-0 w-2 h-2 bg-white rounded-full -translate-y-1/2 shadow-[0_0_10px_#00d9ff]"
            animate={{ left: "100%" }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
        </motion.div>
        <div className="glass px-6 py-3 rounded-full flex items-center gap-2">
          <Globe size="1.5vw" /> Google
        </div>
      </motion.div>
      
      <motion.p
        className="mt-4 text-[1.5vw] text-cyan-200/60 font-mono uppercase tracking-widest"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
      >
        No middleman
      </motion.p>
    </motion.div>
  );
}

// Scene 7: Closing
function Scene7Closing() {
  const [users, setUsers] = useState(30850);
  
  useEffect(() => {
    const timer = setInterval(() => {
      setUsers(prev => {
        if (prev >= 31000) return 31000;
        return prev + Math.floor(Math.random() * 10) + 1;
      });
    }, 50);
    return () => clearInterval(timer);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--st-bg-app)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      <motion.div 
        className="text-[12vw] font-display font-bold leading-none flex items-center gap-6 mb-[4vh]"
        initial={{ scale: 1.5, filter: "blur(20px)" }}
        animate={{ scale: 1, filter: "blur(0px)" }}
        transition={{ duration: 1.5, ease: "circOut" }}
      >
        <span className="text-white" style={{ textShadow: '0 0 40px rgba(255,255,255,0.4)' }}>SNAP</span>
        <span className="text-[var(--st-accent)]" style={{ textShadow: '0 0 80px rgba(0,217,255,0.8), 0 0 150px rgba(0,217,255,0.4)' }}>TO AI</span>
      </motion.div>

      <motion.h2 
        className="text-[3.5vw] font-display tracking-widest text-white uppercase text-center"
        style={{ textShadow: '0 0 30px rgba(0,217,255,0.4)' }}
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1 }}
      >
        Transform your screen into intelligence
      </motion.h2>

      <motion.div 
        className="mt-[8vh] flex flex-col items-center gap-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2 }}
      >
        <div className="text-[2vw] text-gray-400 font-display uppercase tracking-widest">
          Available on Chrome Web Store
        </div>
        <div className="glass px-8 py-4 rounded-2xl flex items-center gap-4 border-[#00d9ff]/30 border shadow-[0_0_30px_rgba(0,217,255,0.1)]">
          <Sparkles className="text-[var(--st-accent)]" size="2vw" />
          <span className="text-[2.5vw] font-mono font-bold text-white">
            {users.toLocaleString()}+ <span className="text-gray-400 font-sans text-[1.5vw]">users</span>
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Utility component for typewriter effect
function TypewriterText({ text, delay }: { text: string, delay: number }) {
  const [displayedText, setDisplayedText] = useState("");
  
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    const startTypewriter = () => {
      let i = 0;
      const intervalId = setInterval(() => {
        setDisplayedText(text.substring(0, i));
        i++;
        if (i > text.length) clearInterval(intervalId);
      }, 50);
      return () => clearInterval(intervalId);
    };
    
    timeoutId = setTimeout(startTypewriter, delay);
    return () => clearTimeout(timeoutId);
  }, [text, delay]);

  return <pre className="whitespace-pre-wrap">{displayedText}</pre>;
}
