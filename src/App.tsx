/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, RotateCcw } from "lucide-react";
import { db } from "./lib/firebase";
import { doc, onSnapshot, updateDoc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";

const GAME_ID = "global";

export default function App() {
  const size = 200;
  const gridRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  // Initial Positions
  const initialBlue = { x: 49, y: 195 };
  const initialRed = { x: 149, y: 195 };

  const [bluePos, setBluePos] = useState(initialBlue);
  const [redPos, setRedPos] = useState(initialRed);
  
  const [blueRot, setBlueRot] = useState(-90);
  const [redRot, setRedRot] = useState(-90);
  
  const [blueTokens, setBlueTokens] = useState(1000);
  const [redTokens, setRedTokens] = useState(1000);
  const [activeModal, setActiveModal] = useState<{
    side: 'blue' | 'red',
    type: 'move' | 'grid'
  } | null>(null);
  
  // Trails - using string keys "x,y"
  const [blueTrail, setBlueTrail] = useState<string[]>([]);
  const [redTrail, setRedTrail] = useState<string[]>([]);

  const [isInitializing, setIsInitializing] = useState(true);

  // Sync with Firestore
  useEffect(() => {
    const gameRef = doc(db, "games", GAME_ID);

    // Initial check/setup
    const initGame = async () => {
      const snap = await getDoc(gameRef);
      if (!snap.exists()) {
        await setDoc(gameRef, {
          bluePos: initialBlue,
          redPos: initialRed,
          blueRot: -90,
          redRot: -90,
          blueTokens: 1000,
          redTokens: 1000,
          blueTrail: [],
          redTrail: [],
          updatedAt: serverTimestamp()
        });
      }
      setIsInitializing(false);
    };
    initGame();

    const unsubscribe = onSnapshot(gameRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        // Only update local state if the change came from another client
        if (!snapshot.metadata.hasPendingWrites) {
          setBluePos(data.bluePos);
          setRedPos(data.redPos);
          setBlueRot(data.blueRot);
          setRedRot(data.redRot);
          setBlueTokens(data.blueTokens);
          setRedTokens(data.redTokens);
          setBlueTrail(data.blueTrail || []);
          setRedTrail(data.redTrail || []);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  const updateFirebase = async (updates: any) => {
    try {
      const gameRef = doc(db, "games", GAME_ID);
      await updateDoc(gameRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      console.error("Firebase update failed", e);
    }
  };

  // Memoize the cells to render them only once
  const cells = useMemo(() => {
    return Array.from({ length: size * size }).map((_, i) => (
      <div 
        key={i} 
        className="w-1 h-1 border border-[#222] box-border shrink-0" 
      />
    ));
  }, [size]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const grid = gridRef.current;
    if (!viewport || !grid) return;

    const update = () => {
      grid.style.transform = `translate(${transformRef.current.x}px, ${transformRef.current.y}px) scale(${transformRef.current.scale})`;
    };

    update();

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomSpeed = 0.0015;
      const delta = -e.deltaY * zoomSpeed;
      const prevScale = transformRef.current.scale;
      const newScale = Math.min(Math.max(0.2, prevScale + delta), 5);

      const rect = viewport.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      transformRef.current.x -= (mx - transformRef.current.x) * (newScale / prevScale - 1);
      transformRef.current.y -= (my - transformRef.current.y) * (newScale / prevScale - 1);
      transformRef.current.scale = newScale;
      update();
    };

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      isDragging.current = true;
      startPos.current = {
        x: e.clientX - transformRef.current.x,
        y: e.clientY - transformRef.current.y
      };
      viewport.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      transformRef.current.x = e.clientX - startPos.current.x;
      transformRef.current.y = e.clientY - startPos.current.y;
      update();
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      viewport.style.cursor = 'grab';
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      
      // Blue controls (WASD)
      if (['w', 'a', 's', 'd'].includes(key)) {
        let nextPos = { ...bluePos };
        let nextRot = blueRot;
        if (key === 'w' && bluePos.y > 0) { nextPos.y -= 1; nextRot = -90; }
        if (key === 's' && bluePos.y < size - 1) { nextPos.y += 1; nextRot = 90; }
        if (key === 'a' && bluePos.x > 0) { nextPos.x -= 1; nextRot = 180; }
        if (key === 'd' && bluePos.x < (size / 2) - 1) { nextPos.x += 1; nextRot = 0; }
        
        if (nextPos.x !== bluePos.x || nextPos.y !== bluePos.y) {
          const newTrail = [...blueTrail, `${bluePos.x},${bluePos.y}`];
          setBluePos(nextPos);
          setBlueRot(nextRot);
          setBlueTrail(newTrail);
          updateFirebase({
            bluePos: nextPos,
            blueRot: nextRot,
            blueTrail: newTrail
          });
        }
      }

      // Red controls (Arrows)
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        let nextPos = { ...redPos };
        let nextRot = redRot;
        if (key === 'arrowup' && redPos.y > 0) { nextPos.y -= 1; nextRot = -90; }
        if (key === 'arrowdown' && redPos.y < size - 1) { nextPos.y += 1; nextRot = 90; }
        if (key === 'arrowleft' && redPos.x > size / 2) { nextPos.x -= 1; nextRot = 180; }
        if (key === 'arrowright' && redPos.x < size - 1) { nextPos.x += 1; nextRot = 0; }
        
        if (nextPos.x !== redPos.x || nextPos.y !== redPos.y) {
          const newTrail = [...redTrail, `${redPos.x},${redPos.y}`];
          setRedPos(nextPos);
          setRedRot(nextRot);
          setRedTrail(newTrail);
          updateFirebase({
            redPos: nextPos,
            redRot: nextRot,
            redTrail: newTrail
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [size]);

  const handleBatchMove = async (steps: number, direction: string) => {
    if (!activeModal) return;
    const { side, type } = activeModal;
    
    const targetSide = type === 'move' ? side : (side === 'blue' ? 'red' : 'blue');
    const isBlueTarget = targetSide === 'blue';
    
    // Get current values
    const currentPos = isBlueTarget ? bluePos : redPos;
    const currentTrail = isBlueTarget ? blueTrail : redTrail;
    const currentTokens = side === 'blue' ? blueTokens : redTokens;

    const cost = type === 'move' ? steps : steps * 2;
    const nextTokens = currentTokens - cost;

    let nextPos = { ...currentPos };
    let newTrailSegment: string[] = [];
    let nextRot = isBlueTarget ? blueRot : redRot;

    for (let i = 0; i < steps; i++) {
        const temp = { ...nextPos };
        if (direction === 'up' && nextPos.y > 0) { nextPos.y -= 1; nextRot = -90; }
        if (direction === 'down' && nextPos.y < size - 1) { nextPos.y += 1; nextRot = 90; }
        if (direction === 'left') {
           if (isBlueTarget && nextPos.x > 0) { nextPos.x -= 1; nextRot = 180; }
           else if (!isBlueTarget && nextPos.x > size / 2) { nextPos.x -= 1; nextRot = 180; }
        }
        if (direction === 'right') {
           if (isBlueTarget && nextPos.x < (size / 2) - 1) { nextPos.x += 1; nextRot = 0; }
           else if (!isBlueTarget && nextPos.x < size - 1) { nextPos.x += 1; nextRot = 0; }
        }
        
        if (nextPos.x !== temp.x || nextPos.y !== temp.y) {
          newTrailSegment.push(`${temp.x},${temp.y}`);
        } else {
          break;
        }
    }

    const finalTrail = [...currentTrail, ...newTrailSegment];

    // Optimistic local update
    if (isBlueTarget) {
      setBluePos(nextPos);
      setBlueRot(nextRot);
      setBlueTrail(finalTrail);
    } else {
      setRedPos(nextPos);
      setRedRot(nextRot);
      setRedTrail(finalTrail);
    }

    if (side === 'blue') setBlueTokens(nextTokens);
    else setRedTokens(nextTokens);

    // Firebase update
    const updates: any = {};
    if (isBlueTarget) {
      updates.bluePos = nextPos;
      updates.blueRot = nextRot;
      updates.blueTrail = finalTrail;
    } else {
      updates.redPos = nextPos;
      updates.redRot = nextRot;
      updates.redTrail = finalTrail;
    }
    
    if (side === 'blue') updates.blueTokens = nextTokens;
    else updates.redTokens = nextTokens;

    await updateFirebase(updates);
    setActiveModal(null);
  };

  const handleZoom = (direction: 'in' | 'out') => {
    const grid = gridRef.current;
    const viewport = viewportRef.current;
    if (!grid || !viewport) return;

    const zoomStep = 0.2;
    const prevScale = transformRef.current.scale;
    const newScale = Math.min(Math.max(0.2, direction === 'in' ? prevScale + zoomStep : prevScale - zoomStep), 5);

    if (newScale === prevScale) return;

    const rect = viewport.getBoundingClientRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;

    transformRef.current.x -= (mx - transformRef.current.x) * (newScale / prevScale - 1);
    transformRef.current.y -= (my - transformRef.current.y) * (newScale / prevScale - 1);
    transformRef.current.scale = newScale;

    grid.style.transform = `translate(${transformRef.current.x}px, ${transformRef.current.y}px) scale(${transformRef.current.scale})`;
  };

  const handleReset = async () => {
    const updates = {
      bluePos: initialBlue,
      redPos: initialRed,
      blueRot: -90,
      redRot: -90,
      blueTokens: 1000,
      redTokens: 1000,
      blueTrail: [],
      redTrail: []
    };
    
    setBluePos(initialBlue);
    setRedPos(initialRed);
    setBlueRot(-90);
    setRedRot(-90);
    setBlueTokens(1000);
    setRedTokens(1000);
    setBlueTrail([]);
    setRedTrail([]);

    await updateFirebase(updates);
  };

  return (
    <div 
      ref={viewportRef}
      className="w-screen h-screen overflow-hidden bg-[#111] cursor-grab select-none flex items-start justify-start"
    >
      {/* Batch Move Modal */}
      {activeModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1a1a1a] border border-white/10 p-6 rounded-2xl shadow-2xl w-80">
            <h3 className="text-white font-bold mb-4 uppercase tracking-wider text-sm flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${activeModal.side === 'blue' ? 'bg-blue-500' : 'bg-red-500'}`} />
              {activeModal.type === 'move' ? `Move ${activeModal.side}` : `Grid (Push ${activeModal.side === 'blue' ? 'Red' : 'Blue'})`}
            </h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const steps = parseInt(formData.get('steps') as string);
              const dir = formData.get('direction') as string;
              handleBatchMove(steps, dir);
            }}>
              <div className="space-y-4">
                <div>
                  <label className="text-white/50 text-[10px] uppercase block mb-1">
                    Steps ({activeModal.type === 'move' ? '1' : '2'} token/step)
                  </label>
                  <input 
                    name="steps" 
                    type="number" 
                    min="1" 
                    defaultValue="10"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-white/30"
                    required
                  />
                </div>
                <div>
                  <label className="text-white/50 text-[10px] uppercase block mb-1">Direction</label>
                  <select 
                    name="direction"
                    className="w-full bg-[#222] border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-white/30 appearance-none"
                  >
                    <option value="up">Up</option>
                    <option value="down">Down</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <button 
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="flex-1 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className={`flex-1 px-4 py-2 rounded-lg text-white text-sm font-bold transition-transform active:scale-95 ${activeModal.side === 'blue' ? 'bg-blue-600' : 'bg-red-600'}`}
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FIXED BOTTOM HUD */}
      <div className="fixed bottom-0 left-0 w-full h-24 bg-black/40 backdrop-blur-xl border-t border-white/5 flex items-center justify-between px-8 z-50">
        
        {/* Blue Side HUD */}
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">Team Blue</span>
            <span className="text-xs text-blue-100/60 font-mono tracking-tighter">{blueTokens.toLocaleString()} TOKENS</span>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'move' })}
              className="w-12 h-12 flex items-center justify-center bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/20 rounded-lg transition-all text-[8px] font-bold uppercase text-center p-1"
              title="Move Blue"
            >
              Move
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'grid' })}
              className="w-12 h-12 flex items-center justify-center bg-blue-900/40 hover:bg-blue-800/60 text-blue-100 border border-blue-500/30 rounded-lg transition-all text-[8px] font-bold uppercase text-center p-1"
              title="Push Red"
            >
              Grid
            </button>
          </div>
        </div>

        {/* Global Controls HUD */}
        <div className="flex items-center gap-2">
          <button 
            onClick={handleReset}
            className="w-12 h-12 flex items-center justify-center bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/20 rounded-lg transition-all"
            title="Reset"
          >
            <RotateCcw size={20} />
          </button>
          <div className="flex flex-col gap-1">
            <button 
              onClick={() => handleZoom('in')}
              className="w-10 h-5 flex items-center justify-center bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-t-sm"
            >
              <Plus size={12} />
            </button>
            <button 
              onClick={() => handleZoom('out')}
              className="w-10 h-5 flex items-center justify-center bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-b-sm"
            >
              <Minus size={12} />
            </button>
          </div>
        </div>

        {/* Red Side HUD */}
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'grid' })}
              className="w-12 h-12 flex items-center justify-center bg-red-900/40 hover:bg-red-800/60 text-red-100 border border-red-500/30 rounded-lg transition-all text-[8px] font-bold uppercase text-center p-1"
              title="Push Blue"
            >
              Grid
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'move' })}
              className="w-12 h-12 flex items-center justify-center bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/20 rounded-lg transition-all text-[8px] font-bold uppercase text-center p-1"
              title="Move Red"
            >
              Move
            </button>
          </div>
          <div className="flex flex-col text-right">
            <span className="text-[10px] text-red-400 font-bold uppercase tracking-widest">Team Red</span>
            <span className="text-xs text-red-100/60 font-mono tracking-tighter">{redTokens.toLocaleString()} TOKENS</span>
          </div>
        </div>

      </div>

      {/* Movement Guides */}
      <div className="fixed top-8 left-8 flex flex-col gap-4 z-50">
        <div className="flex flex-col gap-2 text-white/50 text-[10px] font-mono backdrop-blur-md bg-black/20 p-3 rounded-lg border border-white/10">
          <p><span className="text-blue-400 font-bold">BLUE:</span> WASD</p>
          <p><span className="text-red-400 font-bold">RED:</span> ARROWS</p>
        </div>
      </div>

      <div 
        ref={gridRef}
        className="grid relative flex-none origin-top-left"
        style={{ 
          gridTemplateColumns: `repeat(${size}, 4px)`,
          gridTemplateRows: `repeat(${size}, 4px)` 
        }}
      >
        {cells}

        {/* Trail rendering */}
        {blueTrail.map((coord, idx) => {
          const [tx, ty] = coord.split(',').map(Number);
          return (
             <div 
               key={`blue-${idx}`}
               className="absolute bg-blue-500/30"
               style={{ 
                 left: `${tx * 4}px`, 
                 top: `${ty * 4}px`,
                 width: '4px',
                 height: '4px'
               }}
             />
          );
        })}
        {redTrail.map((coord, idx) => {
          const [tx, ty] = coord.split(',').map(Number);
          return (
             <div 
               key={`red-${idx}`}
               className="absolute bg-red-500/30"
               style={{ 
                 left: `${tx * 4}px`, 
                 top: `${ty * 4}px`,
                 width: '4px',
                 height: '4px'
               }}
             />
          );
        })}

        {/* Left blue shade */}
        <div className="absolute top-0 left-0 w-1/2 h-full bg-blue-500/10 pointer-events-none" />
        
        {/* Right red shade */}
        <div className="absolute top-0 right-0 w-1/2 h-full bg-red-500/10 pointer-events-none" />

        {/* Middle vertical red divider */}
        <div 
          className="absolute top-0 left-1/2 w-[2px] h-full bg-red-600 -translate-x-1/2 pointer-events-none z-10" 
          style={{ left: `${(size * 4) / 2}px` }}
        />

        {/* Blue figure */}
        <img 
          src="https://lh3.googleusercontent.com/d/1SNCMihirT-5iX9Fp_AZTclJTJ0P5kae4"
          className="absolute w-8 h-8 pointer-events-none object-contain z-20"
          style={{ 
            left: `${bluePos.x * 4 - 14}px`, 
            top: `${bluePos.y * 4 - 14}px`,
            transform: `rotate(${blueRot}deg)`,
            transition: 'left 0.1s linear, top 0.1s linear, transform 0.1s ease-out'
          }}
          referrerPolicy="no-referrer"
          alt="Blue figure"
        />

        {/* Red figure (Updated URL and slightly smaller) */}
        <img 
          src="https://lh3.googleusercontent.com/d/1MBQVettULlTDGfz3HDLUojv_4kj7dlkx"
          className="absolute w-8 h-8 pointer-events-none object-contain z-20"
          style={{ 
            left: `${redPos.x * 4 - 14}px`, 
            top: `${redPos.y * 4 - 14}px`,
            transform: `rotate(${redRot}deg)`,
            transition: 'left 0.1s linear, top 0.1s linear, transform 0.1s ease-out'
          }}
          referrerPolicy="no-referrer"
          alt="Red figure"
        />
      </div>
    </div>
  );
}

