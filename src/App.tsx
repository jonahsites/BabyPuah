/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, RotateCcw } from "lucide-react";
import { db, auth } from "./lib/firebase";
import { doc, onSnapshot, updateDoc, setDoc, getDoc, serverTimestamp, increment, collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User as FirebaseUser } from "firebase/auth";

const GAME_ID = "global";

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<{ displayName: string, totalDonated: number, currentTokens: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<{ id: string, displayName: string, totalDonated: number }[]>([]);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  
  const size = 200;
  const gridRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  // Initial Positions
  const initialBlue = { x: 49, y: 195 };
  const initialRed = { x: 149, y: 195 };

  // Login logic
  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login failed", err);
    }
  };

  const handleLogout = () => signOut(auth);

  const buyTokens = async (amount: number) => {
    if (!user) return;
    try {
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: amount, userId: user.uid }),
      });
      const session = await response.json();
      if (session.url) {
        window.location.href = session.url;
      }
    } catch (err) {
      console.error("Payment failed", err);
    }
  };

  // Sync Auth and User Profile
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userRef = doc(db, "users", u.uid);
        const unsubUser = onSnapshot(userRef, (snap) => {
          if (snap.exists()) {
            setProfile(snap.data() as any);
          } else {
            // Create profile
            const newProfile = {
              displayName: u.displayName || "Unknown Wanderer",
              photoURL: u.photoURL || "",
              totalDonated: 0,
              currentTokens: 100, // Initial free tokens?
              updatedAt: serverTimestamp()
            };
            setDoc(userRef, newProfile);
            setProfile(newProfile as any);
          }
        });
        return () => unsubUser();
      } else {
        setProfile(null);
      }
    });

    return () => unsubAuth();
  }, []);

  // Sync Leaderboard
  useEffect(() => {
    const q = query(collection(db, "users"), orderBy("totalDonated", "desc"), limit(10));
    const unsub = onSnapshot(q, (snap) => {
      const donors = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      setLeaderboard(donors);
    });
    return () => unsub();
  }, []);

  // Handle Stripe Success Return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const paymentStatus = params.get("payment");

    if (paymentStatus === "success" && sessionId) {
      const verify = async () => {
        const res = await fetch(`/api/verify-payment?session_id=${sessionId}`);
        const data = await res.json();
        if (data.status === "paid") {
          // Update local state and trigger firebase update if needed
          // The server-side should ideally handle the fulfillment via webhook
          // But for this sandbox, we'll do it on the user profile update if the server verified it
          const userRef = doc(db, "users", data.userId);
          await updateDoc(userRef, {
            currentTokens: increment(data.tokens)
          });
          // Clean up URL
          window.history.replaceState({}, document.title, "/");
        }
      };
      verify();
    }
  }, []);

  const [bluePos, setBluePos] = useState(initialBlue);
  const [redPos, setRedPos] = useState(initialRed);
  
  const [blueRot, setBlueRot] = useState(-90);
  const [redRot, setRedRot] = useState(-90);
  
  const [totalRaised, setTotalRaised] = useState(0);
  const [mineAlert, setMineAlert] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<{
    side: 'blue' | 'red',
    type: 'move' | 'grid' | 'jackpot' | 'teleport' | 'wall' | 'mine'
  } | null>(null);

  const [userRole, setUserRole] = useState<'blue' | 'red' | 'admin' | 'none'>('none');

  const [walls, setWalls] = useState<string[]>([]); // "x,y"
  const [mines, setMines] = useState<string[]>([]); // "x,y"
  const [minesRevealed, setMinesRevealed] = useState(false);
  const [logs, setLogs] = useState<{ msg: string, time: string }[]>([]);
  const [sprintBlue, setSprintBlue] = useState(0); // timestamp until end
  const [sprintRed, setSprintRed] = useState(0); // timestamp until end

  const [isWallBuilding, setIsWallBuilding] = useState<{ side: 'blue' | 'red', budget: number } | null>(null);
  const [jackpotResult, setJackpotResult] = useState<number | null>(null);
  const [isLogOpen, setIsLogOpen] = useState(true);
  
  // Trails - using string keys "x,y"
  const [blueTrail, setBlueTrail] = useState<string[]>([]);
  const [redTrail, setRedTrail] = useState<string[]>([]);

  const [isInitializing, setIsInitializing] = useState(true);

  const canControl = (side: 'blue' | 'red') => {
    if (userRole === 'admin') return true;
    return userRole === side;
  };

  const calculateActualSteps = (side: 'blue' | 'red', steps: number) => {
    const isSprinting = (side === 'blue' ? sprintBlue : sprintRed) > Date.now();
    return isSprinting ? steps * 2 : steps;
  };

  // Sync with Firestore
  useEffect(() => {
    const gameRef = doc(db, "games", GAME_ID);

    // Initial check/setup
    const initGame = async () => {
      try {
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
            walls: [],
            mines: [],
            minesRevealed: false,
            logs: [],
            sprintBlue: 0,
            sprintRed: 0,
            totalRaised: 0,
            updatedAt: serverTimestamp()
          });
        }
      } catch (e) {
        handleFirestoreError(e, 'initialize', `games/${GAME_ID}`);
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
          setTotalRaised(data.totalRaised || 0);
          setBlueTrail(data.blueTrail || []);
          setRedTrail(data.redTrail || []);
          setWalls(data.walls || []);
          setMines(data.mines || []);
          setMinesRevealed(data.minesRevealed || false);
          setLogs(data.logs || []);
          setSprintBlue(data.sprintBlue || 0);
          setSprintRed(data.sprintRed || 0);
        }
      }
    }, (error) => {
      handleFirestoreError(error, 'listen', `games/${GAME_ID}`);
    });

    return () => unsubscribe();
  }, []);

  const addLog = async (msg: string) => {
    const newLog = { msg, time: new Date().toLocaleTimeString() };
    const latestLogs = [newLog, ...logs].slice(0, 10);
    setLogs(latestLogs);
    await updateFirebase({ logs: latestLogs });
  };

  const handleFirestoreError = (error: any, operation: string, path: string) => {
    const errInfo = {
      error: error.message || String(error),
      code: error.code,
      operation,
      path,
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
      }
    };
    console.error('Firestore Error:', JSON.stringify(errInfo));
  };

  const updateFirebase = async (updates: any) => {
    const path = `games/${GAME_ID}`;
    try {
      const gameRef = doc(db, "games", GAME_ID);
      await updateDoc(gameRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
    } catch (e: any) {
      handleFirestoreError(e, 'update', path);
    }
  };

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
      if (['w', 'a', 's', 'd'].includes(key) && canControl('blue')) {
        let nextPos = { ...bluePos };
        let nextRot = blueRot;
        if (key === 'w' && bluePos.y > 0) { nextPos.y -= 1; nextRot = -90; }
        if (key === 's' && bluePos.y < size - 1) { nextPos.y += 1; nextRot = 90; }
        if (key === 'a' && bluePos.x > 0) { nextPos.x -= 1; nextRot = 180; }
        if (key === 'd' && bluePos.x < (size / 2) - 1) { nextPos.x += 1; nextRot = 0; }
        
        if (nextPos.x !== bluePos.x || nextPos.y !== bluePos.y) {
          if (walls.includes(`${nextPos.x},${nextPos.y}`)) return;
          if (mines.includes(`${nextPos.x},${nextPos.y}`)) {
            setMineAlert(`You hit a mine! Resetting to start.`);
            addLog("Blue hit a mine! Resetting to start.");
            setBluePos(initialBlue);
            updateFirebase({ bluePos: initialBlue });
            return;
          }

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
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) && canControl('red')) {
        let nextPos = { ...redPos };
        let nextRot = redRot;
        if (key === 'arrowup' && redPos.y > 0) { nextPos.y -= 1; nextRot = -90; }
        if (key === 'arrowdown' && redPos.y < size - 1) { nextPos.y += 1; nextRot = 90; }
        if (key === 'arrowleft' && redPos.x > size / 2) { nextPos.x -= 1; nextRot = 180; }
        if (key === 'arrowright' && redPos.x < size - 1) { nextPos.x += 1; nextRot = 0; }
        
        if (nextPos.x !== redPos.x || nextPos.y !== redPos.y) {
          if (walls.includes(`${nextPos.x},${nextPos.y}`)) return;
          if (mines.includes(`${nextPos.x},${nextPos.y}`)) {
            setMineAlert(`You hit a mine! Resetting to start.`);
            addLog("Red hit a mine! Resetting to start.");
            setRedPos(initialRed);
            updateFirebase({ redPos: initialRed });
            return;
          }
          
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

  const spendTokens = async (side: 'blue' | 'red', cost: number) => {
    if (!user || !profile) {
      addLog("You must be logged in to spend tokens!");
      return false;
    }
    if (profile.currentTokens < cost) {
      addLog("Not enough tokens! Buy more to support charity.");
      setIsPurchaseModalOpen(true);
      return false;
    }

    const userRef = doc(db, "users", user.uid);
    try {
      await updateDoc(userRef, {
        currentTokens: increment(-cost),
        totalDonated: increment(cost)
      });
    } catch (e) {
      handleFirestoreError(e, 'update', `users/${user.uid}`);
      return false;
    }

    // Global charity counter also goes up
    const gameRef = doc(db, "games", GAME_ID);
    try {
      await updateDoc(gameRef, {
        totalRaised: increment(cost),
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      handleFirestoreError(e, 'update', `games/${GAME_ID}`);
      // Don't fail the whole action if global counter failed, but user tokens were taken
    }

    return true;
  };

  const executeBatchMove = async (side: 'blue' | 'red', targetSideSide: 'blue' | 'red', type: 'move' | 'grid', steps: number, direction: string) => {
    const isBlueTarget = targetSideSide === 'blue';
    
    // Get current values
    const currentPos = isBlueTarget ? bluePos : redPos;
    const currentTrail = isBlueTarget ? blueTrail : redTrail;

    const cost = type === 'move' ? steps : steps * 2;
    
    const success = await spendTokens(side, cost);
    if (!success) return;

    let nextPos = { ...currentPos };
    let newTrailSegment: string[] = [];
    let nextRot = isBlueTarget ? blueRot : redRot;

    const actualSteps = calculateActualSteps(side, steps);

    for (let i = 0; i < actualSteps; i++) {
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
          if (walls.includes(`${nextPos.x},${nextPos.y}`)) {
            nextPos = temp; // Blocked
            break;
          }
          if (mines.includes(`${nextPos.x},${nextPos.y}`)) {
            setMineAlert(`You hit a mine! Resetting to start.`);
            addLog(`${targetSideSide === 'blue' ? 'Blue' : 'Red'} hit a mine during batch move!`);
            nextPos = isBlueTarget ? initialBlue : initialRed;
            break;
          }
          newTrailSegment.push(`${temp.x},${temp.y}`);
        } else {
          break;
        }
    }

    const finalTrail = [...currentTrail, ...newTrailSegment];
    addLog(`${side} used ${cost} tokens to ${type === 'move' ? 'move' : 'push'} ${actualSteps} steps`);

    // Firebase update for the figures (global tokens are no longer used for game figures)
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
    
    await updateFirebase(updates);
  };

  const handleBatchMove = async (steps: number, direction: string) => {
    if (!activeModal) return;
    const { side, type } = activeModal;
    if (type !== 'move' && type !== 'grid') return;

    const targetSideSide = type === 'move' ? side : (side === 'blue' ? 'red' : 'blue');
    await executeBatchMove(side, targetSideSide, type, steps, direction);
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

  const handleJackpot = async (side: 'blue' | 'red') => {
    const cost = 10;
    const success = await spendTokens(side, cost);
    if (!success) return;
    
    const result = Math.floor(Math.random() * 50) + 1;
    setJackpotResult(result);
    addLog(`${side === 'blue' ? 'Blue' : 'Red'} spun the Jackpot and got ${result} steps!`);
    
    setTimeout(() => {
      setJackpotResult(null);
      const rot = side === 'blue' ? blueRot : redRot;
      let dir = 'right';
      if (rot === -90) dir = 'up';
      if (rot === 90) dir = 'down';
      if (rot === 180) dir = 'left';
      if (rot === 0) dir = 'right';
      
      executeBatchMove(side, side, 'move', result, dir);
    }, 2000);
  };

  const handleTeleport = async (side: 'blue' | 'red') => {
    const cost = 5;
    const success = await spendTokens(side, cost);
    if (!success) return;
    
    const current = side === 'blue' ? bluePos : redPos;
    const dx = Math.floor(Math.random() * 11) - 5;
    const dy = Math.floor(Math.random() * 11) - 5;
    
    let nx = current.x + dx;
    let ny = current.y + dy;
    
    // Bounds check
    nx = Math.max(0, Math.min(size - 1, nx));
    ny = Math.max(0, Math.min(size - 1, ny));
    // Side lock
    if (side === 'blue') nx = Math.min((size / 2) - 1, nx);
    else nx = Math.max(size / 2, nx);

    const update: any = {};

    // Calculate trail for teleport (connecting line)
    const currentTrail = side === 'blue' ? blueTrail : redTrail;
    const teleportTrail: string[] = [];
    const steps = Math.max(Math.abs(nx - current.x), Math.abs(ny - current.y));
    for (let i = 1; i <= steps; i++) {
        const tx = Math.floor(current.x + (nx - current.x) * (i / steps));
        const ty = Math.floor(current.y + (ny - current.y) * (i / steps));
        teleportTrail.push(`${tx},${ty}`);
    }
    const finalTrail = [...currentTrail, ...teleportTrail];

    if (side === 'blue') {
      update.bluePos = { x: nx, y: ny };
      update.blueTrail = finalTrail;
    } else {
      update.redPos = { x: nx, y: ny };
      update.redTrail = finalTrail;
    }
    
    addLog(`${side === 'blue' ? 'Blue' : 'Red'} teleported to ${nx}, ${ny}`);
    await updateFirebase(update);
    setActiveModal(null);
  };

  const handleMinefield = async (side: 'blue' | 'red') => {
    const cost = 20;
    const success = await spendTokens(side, cost);
    if (!success) return;
    
    let newMines = [...mines];
    for (let i = 0; i < 20; i++) {
        // Mine target logic: opponent's side
        let rx, ry;
        if (side === 'blue') {
            // Target Red's side (right half)
            rx = Math.floor(Math.random() * (size / 2)) + (size / 2);
        } else {
            // Target Blue's side (left half)
            rx = Math.floor(Math.random() * (size / 2));
        }
        ry = Math.floor(Math.random() * size);
        newMines.push(`${rx},${ry}`);
    }
    setMines(newMines);
    addLog(`${side === 'blue' ? 'Blue' : 'Red'} deployed a minefield!`);
    await updateFirebase({ 
        mines: newMines
    });
    setActiveModal(null);
  };

  const handleSprint = async (side: 'blue' | 'red') => {
    const cost = 10;
    const success = await spendTokens(side, cost);
    if (!success) return;
    
    const end = Date.now() + 30000;
    if (side === 'blue') setSprintBlue(end);
    else setSprintRed(end);
    
    addLog(`${side === 'blue' ? 'Blue' : 'Red'} activated Sprint Mode for 30s!`);
    await updateFirebase({ 
        [side === 'blue' ? 'sprintBlue' : 'sprintRed']: end
    });
    setActiveModal(null);
  };

  const handleRevealMines = async (side: 'blue' | 'red') => {
    const cost = 100;
    const success = await spendTokens(side, cost);
    if (!success) return;

    setMinesRevealed(true);
    addLog(`${side === 'blue' ? 'Blue' : 'Red'} revealed all hidden mines!`);
    await updateFirebase({ 
        minesRevealed: true
    });
  };

  const handleClearMines = async (side: 'blue' | 'red') => {
    const cost = 50;
    const success = await spendTokens(side, cost);
    if (!success) return;

    setMines([]);
    setMinesRevealed(false);
    addLog(`${side === 'blue' ? 'Blue' : 'Red'} cleared all mines from the field!`);
    await updateFirebase({ 
        mines: [],
        minesRevealed: false
    });
  };

  const handleGridClick = async (e: React.MouseEvent) => {
    if (!isWallBuilding) return;
    
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = Math.floor((e.clientX - rect.left) / (4 * transformRef.current.scale));
    const y = Math.floor((e.clientY - rect.top) / (4 * transformRef.current.scale));

    const costPerPixel = 2;
    const side = isWallBuilding.side;
    const success = await spendTokens(side, costPerPixel);
    if (!success) return;

    const newWalls = [...walls, `${x},${y}`];
    
    // Also track local budget (this budget is now redundant but kept for flow)
    const newBudget = isWallBuilding.budget - costPerPixel;

    setWalls(newWalls);
    addLog(`${side === 'blue' ? 'Blue' : 'Red'} built a wall pixel at ${x},${y}`);
    await updateFirebase({ 
        walls: newWalls
    });

    if (newBudget <= 0) {
      setIsWallBuilding(null);
    } else {
      setIsWallBuilding({ ...isWallBuilding, budget: newBudget });
    }
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
      redTrail: [],
      walls: [],
      mines: [],
      minesRevealed: false,
      logs: [],
      sprintBlue: 0,
      sprintRed: 0
    };
    
    setBluePos(initialBlue);
    setRedPos(initialRed);
    setBlueRot(-90);
    setRedRot(-90);
    setBlueTrail([]);
    setRedTrail([]);
    setWalls([]);
    setMines([]);
    setMinesRevealed(false);
    setLogs([]);
    setSprintBlue(0);
    setSprintRed(0);

    await updateFirebase(updates);
  };

  return (
    <div 
      ref={viewportRef}
      className="w-screen h-screen overflow-hidden bg-[#111] cursor-grab select-none flex items-start justify-start"
    >
      {/* Team Selection Overlay */}
      {userRole === 'none' && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 backdrop-blur-md">
          <div className="max-w-md w-full px-8 text-center">
            <h1 className="text-4xl font-black text-white mb-2 italic tracking-tighter uppercase">Pick Your Side</h1>
            <p className="text-white/40 text-sm mb-12 uppercase tracking-widest font-mono">Territory War Simulation v1.0</p>
            <div className="grid grid-cols-2 gap-6">
              <button 
                onClick={() => setUserRole('blue')}
                className="group relative overflow-hidden bg-blue-600/10 border-2 border-blue-600/30 p-8 rounded-2xl hover:bg-blue-600/20 hover:border-blue-500 transition-all duration-500"
              >
                <div className="relative z-10">
                    <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">🟦</div>
                    <div className="text-2xl font-bold text-blue-400 group-hover:text-blue-300">BLUE</div>
                    <div className="text-[10px] text-blue-500/50 mt-2 uppercase font-mono">Strategic Defense</div>
                </div>
              </button>
              <button 
                onClick={() => setUserRole('red')}
                className="group relative overflow-hidden bg-red-600/10 border-2 border-red-600/30 p-8 rounded-2xl hover:bg-red-600/20 hover:border-red-500 transition-all duration-500"
              >
                <div className="relative z-10">
                    <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">🟥</div>
                    <div className="text-2xl font-bold text-red-400 group-hover:text-red-300">RED</div>
                    <div className="text-[10px] text-red-500/50 mt-2 uppercase font-mono">Aggressive Maneuver</div>
                </div>
              </button>
            </div>
            <button 
              onClick={() => setUserRole('admin')}
              className="mt-12 text-white/10 hover:text-white/30 text-[9px] uppercase tracking-[0.2em] transition-colors"
            >
              Enter as Admin
            </button>
          </div>
        </div>
      )}

      {/* Mine Alert Popup */}
      {mineAlert && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="bg-[#111] border-2 border-red-500/50 p-8 rounded-2xl max-w-xs w-full text-center shadow-[0_0_50px_rgba(239,68,68,0.3)]">
            <div className="text-5xl mb-4 animate-bounce">💥</div>
            <h2 className="text-2xl font-black text-white italic uppercase tracking-tighter mb-2">Boom!</h2>
            <p className="text-red-400 font-mono text-xs uppercase tracking-widest mb-6">You hit a mine and were sent back to start</p>
            <button 
              onClick={() => setMineAlert(null)}
              className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg transition-all uppercase text-[10px] tracking-widest"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Batch Move Modal */}
      {activeModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1a1a1a] border border-white/10 p-6 rounded-2xl shadow-2xl w-80">
            <h3 className="text-white font-bold mb-4 uppercase tracking-wider text-sm flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${activeModal.side === 'blue' ? 'bg-blue-500' : 'bg-red-500'}`} />
              {activeModal.type === 'move' ? `Move ${activeModal.side}` : 
               activeModal.type === 'grid' ? `Grid (Push ${activeModal.side === 'blue' ? 'Red' : 'Blue'})` :
               activeModal.type === 'teleport' ? `Teleport ${activeModal.side}` :
               activeModal.type === 'mine' ? `Minefield ${activeModal.side}` :
               activeModal.type === 'jackpot' ? `Jackpot ${activeModal.side}` :
               `Wall ${activeModal.side}`}
            </h3>
            {activeModal.type === 'move' || activeModal.type === 'grid' ? (
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
            ) : (
                <div className="space-y-4">
                   <p className="text-white/70 text-xs">
                     {activeModal.type === 'teleport' ? "Teleport to a random square within 5 pixels for 5 tokens?" :
                      activeModal.type === 'mine' ? "Deploy 20 invisible mines for 20 tokens?" :
                      activeModal.type === 'jackpot' ? "Spin for 1 to 50 steps for 10 tokens?" :
                      "How many tokens do you want to spend on this wall? (2 tokens per pixel)"}
                   </p>
                   {activeModal.type === 'wall' && (
                     <div>
                       <label className="text-white/50 text-[10px] uppercase block mb-1">Tokens (Multiples of 2)</label>
                       <input 
                         id="wall-budget"
                         type="number" 
                         min="2" 
                         step="2"
                         defaultValue="20"
                         className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-white/30"
                         required
                       />
                     </div>
                   )}
                   <div className="flex gap-2 pt-2">
                    <button 
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="flex-1 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      type="button"
                      onClick={() => {
                        if (activeModal.type === 'teleport') handleTeleport(activeModal.side);
                        else if (activeModal.type === 'mine') handleMinefield(activeModal.side);
                        else if (activeModal.type === 'jackpot') handleJackpot(activeModal.side);
                        else if (activeModal.type === 'wall') { 
                          const budget = parseInt((document.getElementById('wall-budget') as HTMLInputElement)?.value || "0");
                          if (budget >= 2) {
                            setIsWallBuilding({ side: activeModal.side, budget }); 
                            setActiveModal(null); 
                          }
                        }
                      }}
                      className={`flex-1 px-4 py-2 rounded-lg text-white text-sm font-bold transition-transform active:scale-95 ${activeModal.side === 'blue' ? 'bg-blue-600' : 'bg-red-600'}`}
                    >
                      Confirm
                    </button>
                  </div>
                </div>
            )}
          </div>
        </div>
      )}

      {/* Jackpot Spinner */}
      {jackpotResult !== null && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80">
          <div className="text-6xl font-bold text-yellow-400 animate-bounce">
            JACKPOT: {jackpotResult} STEPS!
          </div>
        </div>
      )}

      {/* Wall Building Hint */}
      {isWallBuilding && (
        <div className={`fixed top-32 left-1/2 -translate-x-1/2 z-[80] text-black px-4 py-2 rounded-full font-bold text-sm shadow-xl animate-bounce ${isWallBuilding.side === 'blue' ? 'bg-blue-400' : 'bg-red-400'}`}>
          CLICK GRID TO PLACE WALL PIXELS ({isWallBuilding.budget / 2} LEFT)
          <button onClick={() => setIsWallBuilding(null)} className="ml-4 text-black/60 underline text-xs">FINISH</button>
        </div>
      )}

      {/* FIXED BOTTOM HUD */}
      <div className="fixed bottom-0 left-0 w-full h-24 bg-black/40 backdrop-blur-xl border-t border-white/5 flex items-center justify-between px-8 z-50">
        
        {/* Blue Side HUD */}
        <div className={`flex items-center gap-4 transition-opacity ${!canControl('blue') ? 'opacity-30 pointer-events-none grayscale' : ''}`}>
          <div className="flex flex-col group cursor-pointer" onClick={() => setIsPurchaseModalOpen(true)}>
            <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">Team Blue</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-blue-100/60 font-mono tracking-tighter">
                {user ? `${profile?.currentTokens || 0} Tokens` : '$1,000 Global Base'}
              </span>
              <button className="text-[8px] bg-white/10 text-white rounded px-1 group-hover:bg-blue-600 transition-colors">BUY</button>
            </div>
            {sprintBlue > Date.now() && <span className="text-[8px] text-blue-300 animate-pulse">SPRINT ACTIVE</span>}
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'move' })}
              className="w-10 h-10 flex items-center justify-center bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/20 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Move</button>
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'grid' })}
              className="w-10 h-10 flex items-center justify-center bg-blue-900/40 hover:bg-blue-800/60 text-blue-100 border border-blue-500/30 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Grid</button>
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'teleport' })}
              className="w-10 h-10 flex items-center justify-center bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/20 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Tele</button>
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'wall' })}
              className="w-10 h-10 flex items-center justify-center bg-slate-600/20 hover:bg-slate-600/40 text-slate-400 border border-slate-500/20 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Wall</button>
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'mine' })}
              className="w-10 h-10 flex items-center justify-center bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 border border-orange-500/20 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Mine</button>
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'jackpot' })}
              className="w-10 h-10 flex items-center justify-center bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-400 border border-yellow-500/20 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Luck</button>
            <button 
              onClick={() => handleSprint('blue')}
              className="w-10 h-10 flex items-center justify-center bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-400 border border-cyan-500/20 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Run</button>
            {mines.length > 0 && (
              <div className="flex gap-1">
                {!minesRevealed && (
                  <button 
                    onClick={() => handleRevealMines('blue')}
                    className="w-10 h-10 flex items-center justify-center bg-orange-900/40 hover:bg-orange-800/60 text-orange-200 border border-orange-500/30 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
                  >See Mines</button>
                )}
                {minesRevealed && (
                  <button 
                    onClick={() => handleClearMines('blue')}
                    className="w-10 h-10 flex items-center justify-center bg-red-900/40 hover:bg-red-800/60 text-red-100 border border-red-500/30 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
                  >Clear Mines</button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Global Controls HUD */}
        <div className="flex items-center gap-2">
          {userRole === 'admin' && (
            <button 
              onClick={() => setUserRole('none')}
              className="w-12 h-12 flex flex-col items-center justify-center bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/20 rounded-lg transition-all"
              title="Change Side"
            >
              <div className="text-[8px] font-bold">ADMIN</div>
              <div className="text-[7px]">EXIT</div>
            </button>
          )}
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

        {/* Global Log Toggle */}
        <div className="fixed right-4 bottom-28 z-[60] flex flex-col items-end gap-2">
           <button 
             onClick={() => setIsLogOpen(!isLogOpen)}
             className="bg-black/60 backdrop-blur-md border border-white/10 p-2 rounded-full text-white/50 hover:text-white transition-colors shadow-xl"
           >
             <div className="text-[10px] uppercase font-bold px-2 tracking-tighter">
               {isLogOpen ? 'Hide Log' : 'Show Log'}
             </div>
           </button>
           
           {isLogOpen && (
             <div className="w-64 h-64 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-3 overflow-y-auto font-mono text-[9px] shadow-2xl animate-in slide-in-from-right-4 transition-all">
               <div className="text-white/30 uppercase tracking-widest mb-1 border-b border-white/5 pb-1 flex justify-between">
                 <span>Activity Log</span>
               </div>
               {logs.length === 0 && <div className="text-white/10 italic mt-4 text-center">No activity yet</div>}
               {logs.map((log, i) => (
                 <div key={i} className="text-white/60 mb-0.5 border-l border-white/5 pl-2">
                   <span className="text-white/20">[{log.time}]</span> {log.msg}
                 </div>
               ))}
             </div>
           )}
        </div>

        {/* Red Side HUD */}
        <div className={`flex items-center gap-4 transition-opacity ${!canControl('red') ? 'opacity-30 pointer-events-none grayscale' : ''}`}>
          <div className="flex gap-2">
            {mines.length > 0 && (
              <div className="flex gap-1">
                  {!minesRevealed && (
                  <button 
                    onClick={() => handleRevealMines('red')}
                    className="w-10 h-10 flex items-center justify-center bg-orange-900/40 hover:bg-orange-800/60 text-orange-200 border border-orange-500/30 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
                  >See Mines</button>
                )}
                {minesRevealed && (
                  <button 
                    onClick={() => handleClearMines('red')}
                    className="w-10 h-10 flex items-center justify-center bg-red-900/40 hover:bg-red-800/60 text-red-100 border border-red-500/30 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
                  >Clear Mines</button>
                )}
              </div>
            )}
            <button 
              onClick={() => handleSprint('red')}
              className="w-10 h-10 flex items-center justify-center bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-400 border border-cyan-500/20 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Run</button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'jackpot' })}
              className="w-10 h-10 flex items-center justify-center bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-400 border border-yellow-500/20 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Luck</button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'mine' })}
              className="w-10 h-10 flex items-center justify-center bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 border border-orange-500/20 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Mine</button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'wall' })}
              className="w-10 h-10 flex items-center justify-center bg-slate-600/20 hover:bg-slate-600/40 text-slate-400 border border-slate-500/20 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Wall</button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'teleport' })}
              className="w-10 h-10 flex items-center justify-center bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/20 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Tele</button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'grid' })}
              className="w-10 h-10 flex items-center justify-center bg-red-900/40 hover:bg-red-800/60 text-red-100 border border-red-500/30 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Grid</button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'move' })}
              className="w-10 h-10 flex items-center justify-center bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/20 rounded transition-all text-[7px] font-bold uppercase text-center p-1"
            >Move</button>
          </div>
          <div className="flex flex-col items-end group cursor-pointer" onClick={() => setIsPurchaseModalOpen(true)}>
            <span className="text-[10px] text-red-400 font-bold uppercase tracking-widest">Team Red</span>
            <div className="flex items-center gap-2">
              <button className="text-[8px] bg-white/10 text-white rounded px-1 group-hover:bg-red-600 transition-colors">BUY</button>
              <span className="text-xs text-red-100/60 font-mono tracking-tighter">
                {user ? `${profile?.currentTokens || 0} Tokens` : '$1,000 Global Base'}
              </span>
            </div>
            {sprintRed > Date.now() && <span className="text-[8px] text-red-300 animate-pulse">SPRINT ACTIVE</span>}
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

      {/* Charity Counter */}
      <div className="fixed top-8 right-8 z-50 flex items-center gap-4">
        {/* Profile / Login */}
        <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-xl p-2 flex items-center gap-3 pr-4 shadow-xl pointer-events-auto">
          {user ? (
            <>
              <img src={user.photoURL || ""} alt={user.displayName || ""} className="w-8 h-8 rounded-lg border border-white/10" referrerPolicy="no-referrer" />
              <div className="flex flex-col">
                <span className="text-[10px] text-white font-bold tracking-tight leading-none mb-0.5">{user.displayName}</span>
                <span className="text-[8px] text-emerald-400 font-mono uppercase tracking-widest">{profile?.currentTokens || 0} Tokens</span>
              </div>
              <button onClick={handleLogout} className="ml-2 text-white/20 hover:text-white/40"><RotateCcw size={14}/></button>
            </>
          ) : (
            <button 
              onClick={handleLogin}
              className="px-4 py-2 bg-white text-black text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-emerald-400 transition-colors"
            >
              Sign In
            </button>
          )}
        </div>

        <button 
          onClick={() => setIsLeaderboardOpen(true)}
          className="backdrop-blur-md bg-emerald-950/20 p-4 rounded-xl border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.05)] text-right group hover:border-emerald-500/40 transition-all pointer-events-auto"
        >
          <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-[0.2em] group-hover:text-emerald-300">Total Money Raised</span>
          <div className="flex items-baseline gap-1">
             <span className="text-emerald-500/50 font-mono text-xs">$</span>
             <span className="text-3xl font-black text-white italic tracking-tighter tabular-nums">
               {totalRaised.toLocaleString()}
             </span>
          </div>
          <div className="text-[8px] text-emerald-500/40 uppercase tracking-[0.2em] font-mono mt-1">
             Click for Leaderboard
          </div>
        </button>
      </div>

      {/* Leaderboard Modal */}
      {isLeaderboardOpen && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="max-w-md w-full bg-[#111] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-emerald-950/20">
              <div>
                <h2 className="text-2xl font-black text-white italic uppercase tracking-tighter">Big Donors</h2>
                <p className="text-[10px] text-emerald-500/50 uppercase tracking-[0.2em] font-mono">Charity Hall of Fame</p>
              </div>
              <button 
                onClick={() => setIsLeaderboardOpen(false)}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white/50 hover:bg-white/10"
              >✕</button>
            </div>
            <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
              {leaderboard.map((donor, i) => (
                <div key={donor.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-white/20 w-4">{i + 1}</span>
                    <span className="text-sm text-white font-medium">{donor.displayName}</span>
                  </div>
                  <div className="text-emerald-400 font-black italic">
                    <span className="text-[10px] mr-1 opacity-50">$</span>
                    {donor.totalDonated.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-6 bg-white/5 text-[9px] text-white/30 text-center uppercase tracking-widest font-mono">
              100% of proceeds go to humanitarian efforts
            </div>
          </div>
        </div>
      )}

      {/* Purchase Modal */}
      {isPurchaseModalOpen && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="max-w-sm w-full bg-[#111] border border-white/10 rounded-2xl overflow-hidden shadow-2xl p-8 text-center">
            <h2 className="text-3xl font-black text-white italic uppercase tracking-tighter mb-2">Refill Tokens</h2>
            <p className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-mono mb-8">Each token is a $1 donation to charity</p>
            
            <div className="grid grid-cols-2 gap-4 mb-8">
              {[10, 25, 50, 100].map(amount => (
                <button 
                  key={amount}
                  onClick={() => buyTokens(amount)}
                  className="p-6 rounded-xl bg-white/5 border border-white/10 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all group"
                >
                  <div className="text-2xl font-black text-white mb-1 group-hover:scale-110 transition-transform">{amount}</div>
                  <div className="text-[9px] text-emerald-500 font-bold uppercase tracking-widest">${amount}</div>
                </button>
              ))}
            </div>

            <button 
              onClick={() => setIsPurchaseModalOpen(false)}
              className="text-white/20 hover:text-white/40 text-[10px] uppercase tracking-widest font-mono"
            >
              Maybe Later
            </button>
          </div>
        </div>
      )}

      <div 
        ref={gridRef}
        className="relative flex-none origin-top-left"
        style={{ 
          width: `${size * 4}px`,
          height: `${size * 4}px`,
          backgroundImage: 'linear-gradient(to right, #222 1px, transparent 1px), linear-gradient(to bottom, #222 1px, transparent 1px)',
          backgroundSize: '4px 4px'
        }}
        onClick={handleGridClick}
      >
        {walls.map((coord, i) => {
          const [wx, wy] = coord.split(',').map(Number);
          return (
            <div 
              key={`wall-${i}`}
              className="absolute bg-slate-700 border border-slate-500 box-border"
              style={{
                left: `${wx * 4}px`,
                top: `${wy * 4}px`,
                width: '4px',
                height: '4px'
              }}
            />
          );
        })}

        {/* Trail rendering (Chalk marks) */}
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
        {/* Trail rendering (Red) */}
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

        {/* Mines rendering */}
        {minesRevealed && mines.map((coord, idx) => {
          const [mx, my] = coord.split(',').map(Number);
          return (
             <div 
               key={`mine-revealed-${idx}`}
               className="absolute bg-orange-500 rounded-full animate-pulse z-10"
               style={{ 
                 left: `${mx * 4 + 1}px`, 
                 top: `${my * 4 + 1}px`,
                 width: '2px',
                 height: '2px'
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

