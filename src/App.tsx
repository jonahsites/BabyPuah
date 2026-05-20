/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { db, auth } from "./lib/firebase";
import { doc, onSnapshot, updateDoc, setDoc, getDoc, serverTimestamp, increment, collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User as FirebaseUser } from "firebase/auth";

const GAME_ID = "global";

const JACKPOT_SLICES = [
  { value: 50, color: '#eab308' }, // Golden/Yellow Jackpot
  { value: 5, color: '#ef4444' },  // Vibrant Red
  { value: 20, color: '#3b82f6' }, // Electric Blue
  { value: 10, color: '#10b981' }, // Emerald Green
  { value: 1, color: '#ec4899' },  // Hot Pink
  { value: 30, color: '#8b5cf6' }, // Neon Purple
  { value: 15, color: '#06b6d4' }, // Cyan
  { value: 40, color: '#f97316' }, // Blaze Orange
  { value: 2, color: '#14b8a6' },  // Teal
  { value: 25, color: '#a855f7' }, // Lavender/Purple
  { value: 8, color: '#f43f5e' },  // Rose
  { value: 35, color: '#6366f1' }  // Indigo
];

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<{ displayName: string, totalDonated: number, currentTokens: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<{ id: string, displayName: string, totalDonated: number }[]>([]);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  
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
  const handleGuestLogin = () => {
    const guestId = `guest-${Math.floor(Math.random() * 1000000)}`;
    setUser({
      uid: guestId,
      displayName: "Guest Challenger",
      photoURL: "https://lh3.googleusercontent.com/d/1SNCMihirT-5iX9Fp_AZTclJTJ0P5kae4",
      email: "guest@local.sim",
      emailVerified: false,
      isAnonymous: true,
      metadata: {},
      providerData: [],
      refreshToken: "",
      tenantId: null,
      delete: async () => {},
      getIdToken: async () => "",
      getIdTokenResult: async () => ({} as any),
      reload: async () => {},
      toJSON: () => ({})
    } as any);
    setProfile({
      displayName: "Guest Challenger",
      photoURL: "https://lh3.googleusercontent.com/d/1SNCMihirT-5iX9Fp_AZTclJTJ0P5kae4",
      totalDonated: 0,
      currentTokens: 500
    } as any);
    setLoginError(null);
    addLog("Guest Challenger joined the battle locally!");
  };

  const handleLogin = async () => {
    setLoginError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error("Login failed", err);
      if (err.code === "auth/unauthorized-domain") {
        setLoginError(`Domain Unauthorized: "${window.location.hostname}" is not authorized on your Firebase console settings. Please add it to Authorized Domains.`);
      } else if (err.code === "auth/operation-not-allowed") {
        setLoginError('Google Sign-In is disabled in your Firebase console. Please go to Build > Authentication > Sign-in method tab, click "Add new provider", and enable "Google".');
      } else if (err.code === "auth/popup-blocked") {
        setLoginError("Popup was blocked by your browser. Please allow popups or open in a new tab.");
      } else if (err.code === "auth/popup-closed-by-user") {
        setLoginError(`Google sign-in popup closed immediately. Since you're running on custom domain "${window.location.hostname}", this is usually because it is not added to "Authorized Domains" inside your Firebase console settings.`);
      } else {
        setLoginError(err.message || String(err));
      }
    }
  };

  const handleLogout = () => {
    setLoginError(null);
    signOut(auth);
  };

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
    let unsubUser: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      // Clean up previous listener if any
      if (unsubUser) {
        unsubUser();
        unsubUser = null;
      }

      setUser(u);
      if (u) {
        const userRef = doc(db, "users", u.uid);
        unsubUser = onSnapshot(userRef, (snap) => {
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
        }, (err: any) => {
          console.error("Error subscribing to user profile:", err);
          handleFirestoreError(err, 'listen', `users/${u.uid}`);
          
          if (err.code === "permission-denied") {
            setLoginError(`Firestore Permission Denied on user profile. Please deploy your "firestore.rules" file to your Firebase console.`);
          } else {
            setLoginError(`Profile loading error: ${err.message || err.code}`);
          }
        });
      } else {
        setProfile(null);
      }
    });

    return () => {
      unsubAuth();
      if (unsubUser) {
        unsubUser();
      }
    };
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
  const [jackpotSpinning, setJackpotSpinning] = useState<{ side: 'blue' | 'red', rotation: number, isFinished: boolean, resultValue: number } | null>(null);
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

    if (user.uid.startsWith("guest-")) {
      setProfile(prev => prev ? {
        ...prev,
        currentTokens: Math.max(0, prev.currentTokens - cost),
        totalDonated: prev.totalDonated + cost
      } : null);
      
      // Update global raised count locally too so guests see their charity donations tick up!
      setTotalRaised(prev => prev + cost);
      return true;
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
    
    // Choose index from the JACKPOT_SLICES list
    const idx = Math.floor(Math.random() * JACKPOT_SLICES.length);
    const result = JACKPOT_SLICES[idx].value;
    
    // Calculate precise target rotation angle
    const segmentAngle = idx * 30 + 15;
    const targetAngle = -90 - segmentAngle; // aligns segment center with 12 o'clock pointer
    const finalRotation = 360 * 6 + targetAngle; // 6 full clockwise turns + alignment offset
    
    // Close the original prompt modal to let the wheel shine
    setActiveModal(null);
    
    // Begin wheel spin
    setJackpotSpinning({
      side,
      rotation: finalRotation,
      isFinished: false,
      resultValue: result
    });
    
    addLog(`${side === 'blue' ? 'Blue' : 'Red'} initiated the Jackpot fortune spin...`);
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
      className="w-screen h-screen overflow-hidden bg-[#eae6dc] cursor-grab select-none flex items-start justify-start relative font-sans"
      style={{
        backgroundImage: 'radial-gradient(#1e1a15 8%, transparent 8%)',
        backgroundSize: '24px 24px'
      }}
    >
      {/* Team Selection Overlay */}
      {userRole === 'none' && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-[#eae6dc]/80 backdrop-blur-sm p-4 overflow-y-auto">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="max-w-5xl w-full bg-[#fdfaf2] border-4 border-black rounded-3xl p-8 sm:p-12 text-center shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden my-4"
          >
            {/* Playful neobrutalist corner background strips */}
            <div className="absolute top-0 right-0 w-24 h-6 bg-yellow-400 border-b-4 border-l-4 border-black -skew-x-12 transform translate-x-4 -translate-y-1" />
            <div className="absolute bottom-0 left-0 w-28 h-8 bg-rose-400 border-t-4 border-r-4 border-black -skew-x-12 transform -translate-x-4 translate-y-1" />
            
            <motion.h1 
              initial={{ y: -10 }}
              animate={{ y: 0 }}
              className="text-4xl sm:text-6xl font-black text-black tracking-tight uppercase"
            >
              Pick Your Side
            </motion.h1>
            <p className="text-black/60 text-xs mt-2 uppercase tracking-widest font-mono font-bold mb-12">
              ⚡ Territory War Grid v2.0 ⚡
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
              <button 
                onClick={() => setUserRole('blue')}
                className="group relative overflow-hidden bg-[#3b82f6] text-white border-4 border-black p-8 rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all duration-150 cursor-pointer text-center flex flex-col items-center justify-center"
              >
                <div className="mb-6 flex items-center justify-center h-80 w-80">
                  <img 
                    src="https://lh3.googleusercontent.com/d/1SNCMihirT-5iX9Fp_AZTclJTJ0P5kae4" 
                    alt="Blue Stroller" 
                    className="w-80 h-80 object-contain -rotate-90 group-hover:scale-105 transition-transform duration-150 drop-shadow-[8px_8px_0px_rgba(0,0,0,0.35)]"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="text-3xl font-black tracking-tight">TEAM BLUE</div>
                <div className="text-[11px] text-blue-100 font-bold uppercase tracking-wider font-mono mt-2">Strategic Defense</div>
              </button>
              
              <button 
                onClick={() => setUserRole('red')}
                className="group relative overflow-hidden bg-[#ef4444] text-white border-4 border-black p-8 rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all duration-150 cursor-pointer text-center flex flex-col items-center justify-center"
              >
                <div className="mb-6 flex items-center justify-center h-80 w-80">
                  <img 
                    src="https://lh3.googleusercontent.com/d/1MBQVettULlTDGfz3HDLUojv_4kj7dlkx" 
                    alt="Red Stroller" 
                    className="w-80 h-80 object-contain -rotate-90 group-hover:scale-105 transition-transform duration-150 drop-shadow-[8px_8px_0px_rgba(0,0,0,0.35)]"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="text-3xl font-black tracking-tight">TEAM RED</div>
                <div className="text-[11px] text-red-100 font-bold uppercase tracking-wider font-mono mt-2">Aggressive Maneuver</div>
              </button>
            </div>
            
            <div className="mt-12 flex flex-col sm:flex-row gap-4 items-center justify-center relative z-10 w-full max-w-md mx-auto">
              <button 
                onClick={() => setUserRole('admin')}
                className="w-full sm:w-auto px-6 py-3 bg-yellow-300 text-black border-2 border-black rounded-xl text-xs font-black uppercase tracking-widest hover:bg-yellow-400 transition-colors shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0.5 active:translate-x-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              >
                🕶️ Spectate / Admin
              </button>
              {!user && (
                <button 
                  onClick={handleGuestLogin}
                  className="w-full sm:w-auto px-6 py-3 bg-green-300 text-black border-2 border-black rounded-xl text-xs font-black uppercase tracking-widest hover:bg-green-400 transition-colors shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0.5 active:translate-x-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
                >
                  🎮 Play as Guest
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Mine Alert Popup */}
      {mineAlert && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ rotate: -5, scale: 0.9 }}
            animate={{ rotate: 0, scale: 1 }}
            className="bg-yellow-300 border-4 border-black p-8 rounded-3xl max-w-sm w-full text-center shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden"
          >
            <div className="text-6xl mb-4 animate-bounce">💥</div>
            <h2 className="text-3xl font-black text-black uppercase tracking-tight">KABOOM!</h2>
            <p className="text-black font-mono text-xs font-bold uppercase tracking-wider mt-2 mb-6">
              You hit an explosive mine and got blown back to spawn!
            </p>
            <button 
              onClick={() => setMineAlert(null)}
              className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-black border-3 border-black rounded-xl hover:-translate-y-0.5 active:translate-y-0.5 transition-all uppercase text-xs tracking-wider shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
            >
              RE-ENTER ENEMY GRID &rarr;
            </button>
          </motion.div>
        </div>
      )}

      {/* Batch Move Modal */}
      {activeModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            className="bg-white border-4 border-black p-6 rounded-3xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-80 relative font-sans text-black"
          >
            {/* Decorative corner tag */}
            <div className={`absolute top-0 right-0 px-3 py-1 text-[9px] font-black uppercase text-white border-b-3 border-l-3 border-black rounded-tr-[12px] ${activeModal.side === 'blue' ? 'bg-[#3b82f6]' : 'bg-[#ef4444]'}`}>
              {activeModal.side} team
            </div>

            <h3 className="text-black font-black mb-4 uppercase tracking-tight text-lg mt-2 flex items-center gap-2">
              {activeModal.type === 'move' ? `💥 Move ${activeModal.side}` : 
               activeModal.type === 'grid' ? `♟️ Push Grid` :
               activeModal.type === 'teleport' ? `🔮 Teleport` :
               activeModal.type === 'mine' ? `💣 Minefield` :
               activeModal.type === 'jackpot' ? `🎰 Jackpot Spin` :
               `🚧 Erect Wall`}
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
                    <label className="text-black/70 font-black text-[10px] uppercase block mb-1">
                      Steps ({activeModal.type === 'move' ? '1' : '2'} tokens per step)
                    </label>
                    <input 
                      name="steps" 
                      type="number" 
                      min="1" 
                      defaultValue="10"
                      className="w-full bg-yellow-50 border-3 border-black rounded-xl px-3 py-2 text-black font-black outline-none focus:bg-yellow-105"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-black/70 font-black text-[10px] uppercase block mb-1">Direction</label>
                    <div className="relative">
                      <select 
                        name="direction"
                        className="w-full bg-white border-3 border-black rounded-xl px-3 py-2 text-black font-black outline-none appearance-none"
                      >
                        <option value="up">▲ Up</option>
                        <option value="down">▼ Down</option>
                        <option value="left">◀ Left</option>
                        <option value="right">▶ Right</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button 
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="flex-1 px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-black border-2 border-black text-xs font-black uppercase transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      className={`flex-1 px-4 py-2 rounded-xl text-white text-xs font-black uppercase border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer ${activeModal.side === 'blue' ? 'bg-[#3b82f6]' : 'bg-[#ef4444]'}`}
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              </form>
            ) : (
                <div className="space-y-4">
                   <p className="text-black/80 text-xs font-bold leading-relaxed">
                     {activeModal.type === 'teleport' ? "🔮 Teleport to a random safe zone within 5 range blocks? (Cost: 5 tokens)" :
                      activeModal.type === 'mine' ? "💣 Disperse a barrage of 20 invisible stealth mines across the grid? (Cost: 20 tokens)" :
                      activeModal.type === 'jackpot' ? "🎰 Spin the physical wheel for a random payload of 1 to 50 moves! (Cost: 10 tokens)" :
                      "How many tokens do you want to assign to this fortification? (Wall costs 2 tokens per pixel)"}
                   </p>
                   {activeModal.type === 'wall' && (
                     <div>
                       <label className="text-black/70 font-black text-[10px] uppercase block mb-1">Tokens (Multiples of 2)</label>
                       <input 
                         id="wall-budget"
                         type="number" 
                         min="2" 
                         step="2"
                         defaultValue="20"
                         className="w-full bg-yellow-50 border-3 border-black rounded-xl px-3 py-2 text-black font-black outline-none focus:bg-yellow-105"
                         required
                       />
                     </div>
                   )}
                   <div className="flex gap-3 pt-2">
                    <button 
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="flex-1 px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-black border-2 border-black text-xs font-black uppercase transition-colors cursor-pointer"
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
                      className={`flex-1 px-4 py-2 rounded-xl text-white text-xs font-black uppercase border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer ${activeModal.side === 'blue' ? 'bg-[#3b82f6]' : 'bg-[#ef4444]'}`}
                    >
                      Confirm
                    </button>
                  </div>
                </div>
            )}
          </motion.div>
        </div>
      )}

      {/* Real Spinning Jackpot Wheel */}
      {jackpotSpinning !== null && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-[#fffef4] border-4 border-black p-6 rounded-3xl max-w-sm w-full shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] text-center relative overflow-hidden"
          >
            {/* Top decorative banner */}
            <div className={`text-[10px] font-black uppercase inline-block px-3 py-1 border-2 border-black rounded-full mb-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-black ${
              jackpotSpinning.side === 'blue' ? 'bg-blue-200' : 'bg-red-200'
            }`}>
              🎰 {jackpotSpinning.side === 'blue' ? 'Blue Team' : 'Red Team'} jackpot
            </div>

            <h3 className="font-sans font-black text-2xl text-black uppercase tracking-tight mb-6">
              {jackpotSpinning.isFinished ? "🎉 SPIN COMPLETE! 🎉" : "🌀 SPINNING WHEEL... 🌀"}
            </h3>

            {/* Wheel Container with Pointer */}
            <div className="relative w-64 h-64 mx-auto mb-6 flex items-center justify-center">
              {/* Little neo-brutalist pointer at 12 o'clock */}
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[16px] border-l-transparent border-r-transparent border-t-rose-600 z-20" />
              <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-r-[12px] border-t-[18px] border-l-transparent border-r-transparent border-t-black z-10" />

              {/* Spinning Wheel */}
              <motion.div
                initial={{ rotate: 0 }}
                animate={{ rotate: jackpotSpinning.rotation }}
                transition={{ 
                  type: "spring",
                  damping: 18, 
                  stiffness: 50,
                  mass: 1.2
                }}
                className="w-full h-full rounded-full border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] relative select-none origin-center"
                onAnimationComplete={() => {
                  setJackpotSpinning(prev => prev ? { ...prev, isFinished: true } : null);
                }}
              >
                {/* SVG representing the segmented slices */}
                <svg viewBox="0 0 200 200" className="w-full h-full rounded-full overflow-hidden select-none pointer-events-none">
                  {JACKPOT_SLICES.map((slice, i) => (
                    <g key={i} transform={`rotate(${i * 30}, 100, 100)`}>
                      {/* Wedge segment */}
                      <path 
                        d="M 100 100 L 200 100 A 100 100 0 0 1 186.6 150 Z" 
                        fill={slice.color} 
                        stroke="black" 
                        strokeWidth="3.5" 
                      />
                      {/* Text segment centered radial offset */}
                      <g transform="rotate(15, 100, 100)">
                        <text 
                          x="152" 
                          y="105" 
                          fontWeight="900" 
                          textAnchor="middle" 
                          fontSize="13px" 
                          fill="white"
                          fontFamily="sans-serif"
                          stroke="black"
                          strokeWidth="2.5"
                          paintOrder="stroke"
                          transform="rotate(90, 152, 105)"
                        >
                          {slice.value}
                        </text>
                      </g>
                    </g>
                  ))}
                  {/* Outer circle line helper */}
                  <circle cx="100" cy="100" r="99" fill="none" stroke="black" strokeWidth="3" />
                  {/* Center cap cover hub */}
                  <circle cx="100" cy="100" r="18" fill="white" stroke="black" strokeWidth="4" />
                  <circle cx="100" cy="100" r="8" fill="black" />
                </svg>
              </motion.div>
            </div>

            {/* Post-Spin Celebration & Actions */}
            <div className="h-20 flex flex-col items-center justify-center">
              {jackpotSpinning.isFinished ? (
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex flex-col items-center gap-2"
                >
                  <p className="text-sm font-bold text-black/70">
                    WON <span className="text-xl font-black text-rose-600 border px-2 py-0.5 rounded-md bg-yellow-200 border-black">{jackpotSpinning.resultValue}</span> STEPS!
                  </p>
                  
                  <button
                    onClick={() => {
                      const { side, resultValue } = jackpotSpinning;
                      const rot = side === 'blue' ? blueRot : redRot;
                      let dir = 'right';
                      if (rot === -90) dir = 'up';
                      if (rot === 90) dir = 'down';
                      if (rot === 180) dir = 'left';
                      if (rot === 0) dir = 'right';
                      
                      executeBatchMove(side, side, 'move', resultValue, dir);
                      addLog(`${side === 'blue' ? 'Blue' : 'Red'} executed their jackpot of ${resultValue} steps!`);
                      setJackpotSpinning(null);
                    }}
                    className="px-6 py-2 rounded-xl bg-yellow-300 hover:bg-yellow-400 border-2 border-black font-black text-xs uppercase tracking-wider text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer"
                  >
                    🚀 Let's Move!
                  </button>
                </motion.div>
              ) : (
                <div className="text-black/50 font-bold text-xs flex items-center gap-2 animate-pulse">
                  <span>⚙️</span> Physics engine deciding your fate...
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Wall Building Hint */}
      {isWallBuilding && (
        <div className={`fixed top-32 left-1/2 -translate-x-1/2 z-[80] text-black px-4 py-2 rounded-full font-bold text-sm shadow-xl animate-bounce bg-yellow-300 border-2 border-black`}>
          CLICK GRID TO PLACE WALL PIXELS ({isWallBuilding.budget / 2} LEFT)
          <button onClick={() => setIsWallBuilding(null)} className="ml-4 text-black/60 underline text-xs font-black">FINISH &times;</button>
        </div>
      )}

      {/* FIXED BOTTOM HUD */}
      <div className="fixed bottom-0 left-0 w-full h-24 bg-[#fcfaf4] border-t-4 border-black flex items-center justify-between px-8 z-50 shadow-[0_-5px_0px_0px_rgba(0,0,0,1)] text-black">
        
        {/* Blue Side HUD */}
        <div className={`flex items-center gap-4 transition-opacity ${!canControl('blue') ? 'opacity-30 pointer-events-none grayscale' : ''}`}>
          <div className="flex flex-col group cursor-pointer bg-white border-2 border-black p-1.5 rounded-xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all" onClick={() => setIsPurchaseModalOpen(true)}>
            <span className="text-[10px] text-blue-600 font-black uppercase tracking-wider">💙 Team Blue</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-black font-mono font-bold">
                {user ? `${profile?.currentTokens || 0} Tokens` : '$1,000 Base'}
              </span>
              <button className="text-[8px] bg-yellow-300 text-black border border-black font-black rounded px-1 transition-colors uppercase">REFILL</button>
            </div>
            {sprintBlue > Date.now() && <span className="text-[8px] text-blue-600 font-black tracking-widest animate-pulse">⚡ SPRINT ACTIVE</span>}
          </div>

          <div className="flex gap-2">
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'move' })}
              className="w-10 h-10 flex flex-col items-center justify-center bg-[#3b82f6] border-2 border-black rounded-lg text-white font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Move"
            >
              <span className="text-sm">💥</span>
              <span className="text-[6px] tracking-tighter">MOVE</span>
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'grid' })}
              className="w-10 h-10 flex flex-col items-center justify-center bg-blue-105 border-2 border-black rounded-lg text-black font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Push Grid"
            >
              <span className="text-sm">♟️</span>
              <span className="text-[6px] tracking-tighter">GRID</span>
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'teleport' })}
              className="w-10 h-10 flex flex-col items-center justify-center bg-purple-200 border-2 border-black rounded-lg text-black font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Teleport"
            >
              <span className="text-sm">🔮</span>
              <span className="text-[6px] tracking-tighter">TELE</span>
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'wall' })}
              className="w-10 h-10 flex flex-col items-center justify-center bg-slate-200 border-2 border-black rounded-lg text-black font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Wall"
            >
              <span className="text-sm">🚧</span>
              <span className="text-[6px] tracking-tighter">WALL</span>
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'mine' })}
              className="w-10 h-10 flex flex-col items-center justify-center bg-orange-200 border-2 border-black rounded-lg text-black font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Mine"
            >
              <span className="text-sm">💣</span>
              <span className="text-[6px] tracking-tighter">MINE</span>
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'blue', type: 'jackpot' })}
              className="w-10 h-10 flex flex-col items-center justify-center bg-yellow-200 border-2 border-black rounded-lg text-black font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Luck"
            >
              <span className="text-sm">🎰</span>
              <span className="text-[6px] tracking-tighter">LUCK</span>
            </button>
            <button 
              onClick={() => handleSprint('blue')}
              className="w-10 h-10 flex flex-col items-center justify-center bg-cyan-200 border-2 border-black rounded-lg text-black font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Sprint Run"
            >
              <span className="text-sm">🏃</span>
              <span className="text-[6px] tracking-tighter">RUN</span>
            </button>
            
            {mines.length > 0 && (
              <div className="flex gap-1">
                {!minesRevealed && (
                  <button 
                    onClick={() => handleRevealMines('blue')}
                    className="w-10 h-10 flex flex-col items-center justify-center bg-amber-200 border-2 border-black rounded-lg text-black font-bold text-[8px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
                  >
                    <span>👁️</span>
                    <span className="text-[5px]">MINES</span>
                  </button>
                )}
                {minesRevealed && (
                  <button 
                    onClick={() => handleClearMines('blue')}
                    className="w-10 h-10 flex flex-col items-center justify-center bg-rose-200 border-2 border-black rounded-lg text-black font-bold text-[8px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
                  >
                    <span>🧹</span>
                    <span className="text-[5px]">CLEAR</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Global Controls HUD */}
        <div className="flex items-center gap-3">
          {userRole === 'admin' && (
            <button 
              onClick={() => setUserRole('none')}
              className="w-12 h-12 flex flex-col items-center justify-center bg-purple-300 border-2 border-black rounded-xl hover:-translate-y-0.5 active:translate-y-0.5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] text-black cursor-pointer"
              title="Change Side"
            >
              <div className="text-[8px] font-black uppercase">ADMIN</div>
              <div className="text-[7px] font-bold">EXIT</div>
            </button>
          )}
          <button 
            onClick={handleReset}
            className="w-12 h-12 flex items-center justify-center bg-rose-300 border-2 border-black rounded-xl hover:-translate-y-0.5 active:translate-y-0.5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] text-black cursor-pointer"
            title="Reset Game"
          >
            <RotateCcw size={18} className="font-bold stroke-[3]" />
          </button>
          
          <div className="flex items-center border-2 border-black bg-white rounded-xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
            <button 
              onClick={() => handleZoom('in')}
              className="w-8 h-8 flex items-center justify-center bg-gray-50 hover:bg-gray-150 text-black border-r-2 border-black cursor-pointer font-black"
            >
              <Plus size={14} className="stroke-[3]" />
            </button>
            <button 
              onClick={() => handleZoom('out')}
              className="w-8 h-8 flex items-center justify-center bg-gray-50 hover:bg-gray-150 text-black cursor-pointer font-black"
            >
              <Minus size={14} className="stroke-[3]" />
            </button>
          </div>
        </div>

        {/* Global Log Toggle */}
        <div className="fixed right-6 bottom-28 z-[60] flex flex-col items-end gap-2.5">
           <button 
             onClick={() => setIsLogOpen(!isLogOpen)}
             className="bg-white border-3 border-black px-4 py-2 rounded-full text-black hover:-translate-y-0.5 active:translate-y-0.5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform cursor-pointer"
           >
             <div className="text-[10px] uppercase font-black tracking-wider flex items-center gap-1">
               <span>📜</span> {isLogOpen ? 'Hide Logs' : 'Show Logs'}
             </div>
           </button>
           
           {isLogOpen && (
             <motion.div 
               initial={{ opacity: 0, y: 10, scale: 0.95 }}
               animate={{ opacity: 1, y: 0, scale: 1 }}
               className="w-72 h-64 bg-[#fffef4] border-3 border-black rounded-2xl p-4 overflow-y-auto font-mono text-[9px] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] text-black text-left"
             >
               <div className="text-black/50 uppercase tracking-widest font-black mb-2.5 border-b-2 border-black pb-1.5 flex justify-between">
                 <span>🌐 Activity Log</span>
               </div>
               {logs.length === 0 && <div className="text-black/30 italic mt-6 text-center">Empty ledger state</div>}
               {logs.map((log, i) => (
                 <div key={i} className="text-black/80 mb-1 pl-1 line-clamp-2">
                   <span className="text-black/40 font-black">[{log.time}]</span> {log.msg}
                 </div>
               ))}
             </motion.div>
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
                    className="w-10 h-10 flex flex-col items-center justify-center bg-amber-200 border-2 border-black rounded-lg text-black font-bold text-[8px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
                  >
                    <span>👁️</span>
                    <span className="text-[5px]">MINES</span>
                  </button>
                )}
                {minesRevealed && (
                  <button 
                    onClick={() => handleClearMines('red')}
                    className="w-10 h-10 flex flex-col items-center justify-center bg-rose-200 border-2 border-black rounded-lg text-black font-bold text-[8px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
                  >
                    <span>🧹</span>
                    <span className="text-[5px]">CLEAR</span>
                  </button>
                )}
              </div>
            )}
            <button 
              onClick={() => handleSprint('red')}
              className="w-10 h-10 flex flex-col items-center justify-center bg-cyan-200 border-2 border-black rounded-lg text-black font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Sprint Run"
            >
              <span className="text-sm">🏃</span>
              <span className="text-[6px] tracking-tighter">RUN</span>
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'jackpot' })}
              className="w-10 h-10 flex flex-col items-center justify-center bg-yellow-200 border-2 border-black rounded-lg text-black font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Lucky Jackpot"
            >
              <span className="text-sm">🎰</span>
              <span className="text-[6px] tracking-tighter">LUCK</span>
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'mine' })}
              className="w-10 h-10 flex flex-col items-center justify-center bg-orange-200 border-2 border-black rounded-lg text-black font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Minefield"
            >
              <span className="text-sm">💣</span>
              <span className="text-[6px] tracking-tighter">MINE</span>
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'wall' })}
              className="w-10 h-10 flex flex-col items-center justify-center bg-slate-250 border-2 border-black rounded-lg text-black font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Fortify Wall"
            >
              <span className="text-sm">🚧</span>
              <span className="text-[6px] tracking-tighter">WALL</span>
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'teleport' })}
              className="w-10 h-10 flex flex-col items-center justify-center bg-purple-200 border-2 border-black rounded-lg text-black font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Teleport"
            >
              <span className="text-sm">🔮</span>
              <span className="text-[6px] tracking-tighter">TELE</span>
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'grid' })}
              className="w-10 h-10 flex flex-col items-center justify-center bg-blue-105 border-2 border-black rounded-lg text-black font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Push Grid"
            >
              <span className="text-sm">♟️</span>
              <span className="text-[6px] tracking-tighter">GRID</span>
            </button>
            <button 
              onClick={() => setActiveModal({ side: 'red', type: 'move' })}
              className="w-10 h-10 flex flex-col items-center justify-center bg-[#ef4444] border-2 border-black rounded-lg text-white font-black text-[9px] uppercase hover:-translate-y-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              title="Move Pack"
            >
              <span className="text-sm">💥</span>
              <span className="text-[6px] tracking-tighter">MOVE</span>
            </button>
          </div>
          
          <div className="flex flex-col items-end group cursor-pointer bg-white border-2 border-black p-1.5 rounded-xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all" onClick={() => setIsPurchaseModalOpen(true)}>
            <span className="text-[10px] text-red-600 font-black uppercase tracking-wider">❤️ Team Red</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <button className="text-[8px] bg-yellow-300 text-black border border-black font-black rounded px-1 transition-colors uppercase">REFILL</button>
              <span className="text-[10px] text-black font-mono font-bold">
                {user ? `${profile?.currentTokens || 0} Tokens` : '$1,000 Base'}
              </span>
            </div>
            {sprintRed > Date.now() && <span className="text-[8px] text-red-600 font-black tracking-widest animate-pulse">⚡ SPRINT ACTIVE</span>}
          </div>
        </div>
      </div>

      {/* Movement Guides */}
      <div className="fixed top-8 left-8 flex flex-col gap-4 z-50">
        <div className="flex flex-col gap-2 text-black text-[10px] font-mono bg-yellow-200 border-3 border-black p-4 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] font-bold">
          <p className="uppercase font-black text-xs border-b border-black pb-1.5 mb-1 tracking-tight">🎮 CONTROLS</p>
          <p><span className="text-blue-600 font-extrabold">BLUE TEAM:</span> W, A, S, D Keyboards</p>
          <p><span className="text-red-600 font-extrabold">RED TEAM:</span> ARROW Keys</p>
        </div>
      </div>

      {/* Charity Counter */}
      <div className="fixed top-8 right-8 z-50 flex flex-col items-end gap-3">
        <div className="flex items-center gap-4">
          {/* Profile / Login */}
          <div className="bg-[#fcfaf4] border-3 border-black rounded-2xl p-2.5 flex items-center gap-3 pr-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] pointer-events-auto">
            {user ? (
              <>
                <img src={user.photoURL || ""} alt={user.displayName || ""} className="w-8 h-8 rounded-lg border-2 border-black" referrerPolicy="no-referrer" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-black font-extrabold tracking-tight leading-none mb-0.5">{user.displayName}</span>
                  <span className="text-[8px] bg-green-200 text-black border border-black font-black uppercase tracking-wider px-1 rounded-sm">{profile?.currentTokens || 0} Tokens</span>
                </div>
                <button onClick={handleLogout} className="ml-2 text-gray-500 hover:text-red-500 border border-transparent hover:border-black p-1 hover:bg-yellow-250 rounded transition-all cursor-pointer" title="Sign Out"><RotateCcw size={13}/></button>
              </>
            ) : (
              <button 
                onClick={handleLogin}
                className="px-4 py-2 bg-yellow-300 text-black text-[10px] font-black uppercase tracking-widest rounded-xl border-2 border-black hover:bg-yellow-400 transition-colors cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:translate-x-0.5 active:shadow-[0px_0px_0px_0px_rgba(0,0,0,1)]"
              >
                Sign In
              </button>
            )}
          </div>

          <button 
            onClick={() => setIsLeaderboardOpen(true)}
            className="bg-white border-3 border-black p-4 rounded-2xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] text-right group hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all pointer-events-auto cursor-pointer"
          >
            <span className="text-[10px] text-black/60 font-black uppercase tracking-wider group-hover:text-black font-sans">💖 Donated to Charity</span>
            <div className="flex items-baseline gap-1 justify-end font-extrabold">
               <span className="text-black/50 font-mono text-sm">$</span>
               <span className="text-3xl font-black text-black italic tracking-tighter tabular-nums font-sans">
                 {totalRaised.toLocaleString()}
               </span>
            </div>
            <div className="text-[8px] text-black/40 uppercase tracking-widest font-black mt-1">
               Click for Hall of Fame &rarr;
            </div>
          </button>
        </div>

        {/* Dynamic Auth Troubleshooting Instructions */}
        {loginError && (
          <div className="max-w-[320px] bg-[#fffbf2] border-3 border-black text-black text-xs p-4 rounded-2xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] space-y-3 pointer-events-auto text-left">
            <div className="flex justify-between items-center border-b-2 border-black pb-2">
              <span className="font-extrabold text-red-600 uppercase tracking-wider text-[11px] flex items-center gap-1">⚠️ SIGN IN NOTICE</span>
              <button 
                onClick={() => setLoginError(null)} 
                className="text-gray-500 hover:text-black hover:bg-gray-200 border border-transparent hover:border-black rounded px-1.5 py-0.5 text-xs transition-all font-black cursor-pointer"
              >
                ✕
              </button>
            </div>
            
            <p className="font-sans font-extrabold text-[#dc2626] leading-snug">
              {loginError}
            </p>

            <div className="border-t-2 border-black pt-3 mt-1 space-y-2">
              <p className="font-black text-[10px] tracking-wider text-black uppercase">DEVELOPER GUIDE:</p>
              <p className="text-[10px] leading-relaxed text-black/80 font-medium font-sans">
                If you're seeing a blank page that closes, add this domain as an authorized redirect under <strong className="font-extrabold">Authentication &rsaquo; Settings &rsaquo; Authorized Domains</strong> inside your Firebase Console:
              </p>
              
              <div className="bg-white border-2 border-dashed border-black p-2 rounded-lg text-center mt-1">
                <code className="text-xs select-all font-bold font-mono text-black">
                  {window.location.hostname}
                </code>
              </div>

              <a 
                href="https://console.firebase.google.com/project/knotted-inkwell-mcf5x/authentication/settings" 
                target="_blank" 
                rel="noreferrer"
                className="inline-flex items-center justify-center w-full mt-2 px-4 py-2.5 bg-yellow-300 hover:bg-yellow-400 text-black border-2 border-black font-black text-[10px] uppercase rounded-xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer text-center"
              >
                Firebase Console Link &rarr;
              </a>

              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-black/20"></div>
                <span className="flex-shrink mx-3 text-[9px] text-black/40 font-bold uppercase tracking-wider">OR</span>
                <div className="flex-grow border-t border-black/20"></div>
              </div>

              <button
                onClick={handleGuestLogin}
                className="w-full px-4 py-2.5 bg-green-300 hover:bg-green-400 text-black border-2 border-black font-black text-[10px] uppercase rounded-xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer text-center"
              >
                🎮 Play as Local Guest (500 free tokens)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Leaderboard Modal */}
      {isLeaderboardOpen && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 text-black">
          <motion.div 
            initial={{ scale: 0.9, y: 15 }}
            animate={{ scale: 1, y: 0 }}
            className="max-w-md w-full bg-[#fdfdfc] border-4 border-black rounded-3xl overflow-hidden shadow-[10px_10px_0px_0px_rgba(0,0,0,1)]"
          >
            <div className="p-6 border-b-4 border-black bg-yellow-300 flex justify-between items-center">
              <div>
                <h2 className="text-3xl font-black text-black uppercase tracking-tight">Leaderboard</h2>
                <p className="text-[9px] text-black font-black uppercase tracking-wider font-mono">Charity Hall of Fame</p>
              </div>
              <button 
                onClick={() => setIsLeaderboardOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-lg border-2 border-black bg-rose-500 text-white font-black hover:bg-rose-600 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              >✕</button>
            </div>
            <div className="p-6 space-y-3 max-h-[50vh] overflow-y-auto bg-white/50">
              {leaderboard.length === 0 && (
                <div className="text-center italic text-black/40 text-xs py-8">Be the first player to donate and top the ranks!</div>
              )}
              {leaderboard.map((donor, i) => (
                <div key={donor.id} className="flex items-center justify-between p-3.5 rounded-xl bg-white border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black bg-yellow-105 text-black w-6 h-6 rounded-md flex items-center justify-center border border-black">{i + 1}</span>
                    <span className="text-xs text-black font-black uppercase">{donor.displayName}</span>
                  </div>
                  <div className="text-black font-black text-sm italic bg-green-200 border border-black px-2.5 py-0.5 rounded-md flex items-center gap-0.5">
                    <span className="text-[10px] mr-1 opacity-60">$</span>
                    {donor.totalDonated.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 bg-yellow-101 border-t-3 border-black text-[9px] text-black/60 text-center uppercase tracking-wider font-black font-mono">
              ★ 100% of proceeds go directly to humanitarian efforts ★
            </div>
          </motion.div>
        </div>
      )}

      {/* Purchase Modal */}
      {isPurchaseModalOpen && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 backdrop-blur-sm overflow-y-auto p-4 text-black">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="max-w-4xl w-full bg-[#f0f0f0] border-4 border-black rounded-3xl p-6 sm:p-8 relative shadow-[10px_10px_0px_0px_rgba(0,0,0,1)]"
          >
            {/* Header section closely matching pricing-container */}
            <div className="text-center mb-10 relative z-10">
              <div className="inline-block relative">
                <h2 className="text-3xl sm:text-4xl font-black text-black bg-yellow-300 px-8 py-3 rounded-2xl border-4 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] uppercase -skew-x-1">
                  Refill Game Tokens
                </h2>
                <div className="h-1 bg-black rounded-full mt-4 w-full" />
              </div>
              <p className="text-[10px] text-black font-black uppercase tracking-widest mt-3 font-mono">
                ⭐ Each token is a $1 direct contribution to humanitarian aid channels ⭐
              </p>
            </div>

            {/* Back effects inside the modal */}
            <div className="absolute inset-0 pointer-events-none opacity-20">
              <div className="absolute inset-0" style={{
                backgroundImage: "linear-gradient(#00000010 1px, transparent 1px), linear-gradient(90deg, #00000010 1px, transparent 1px)",
                backgroundSize: "20px 20px"
              }} />
            </div>

            {/* Closing Button */}
            <button 
              onClick={() => setIsPurchaseModalOpen(false)}
              className="absolute top-4 right-4 w-10 h-10 border-3 border-black rounded-xl bg-rose-500 text-white font-black hover:bg-rose-600 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0.5 transition-all text-sm flex items-center justify-center cursor-pointer"
            >
              ✕
            </button>

            {/* Pricing / Packages Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
              {/* Starter Pack */}
              <motion.div
                whileHover={{ rotate: -1, scale: 1.02 }}
                className="bg-white rounded-2xl p-6 border-3 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl font-black text-black">Starter Pack</h3>
                    <span className="px-3 py-1 bg-rose-500 text-white font-black text-[9px] rounded-lg border-2 border-black uppercase">
                      REFUEL
                    </span>
                  </div>
                  <ul className="space-y-2 mb-6 text-black">
                    {["10 Complete Tokens", "Paint Custom Walls", "Support Global Aid", "Standard Placement"].map((f, i) => (
                      <li key={i} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded-lg border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] text-[11px] font-bold">
                        <span className="w-4 h-4 rounded-md bg-rose-500 text-white flex items-center justify-center text-[9px] border border-black">✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
                <button 
                  onClick={() => buyTokens(10)}
                  className="w-full py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-black text-xs border-3 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer rounded-xl uppercase"
                >
                  Get 10 Tokens for $10 &rarr;
                </button>
              </motion.div>

              {/* Pro / Tactician Pack */}
              <motion.div
                whileHover={{ rotate: 1, scale: 1.03 }}
                className="bg-white rounded-2xl p-6 border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between relative"
              >
                {/* Popular band */}
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-yellow-300 text-black border-2 border-black rounded-lg text-[9px] font-black uppercase tracking-widest shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                  ⚡ POPULAR CHOICE
                </div>

                <div className="mt-2">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl font-black text-black">Tactician</h3>
                    <span className="px-3 py-1 bg-blue-500 text-white font-black text-[9px] rounded-lg border-2 border-black uppercase">
                      BEST VALUE
                    </span>
                  </div>
                  <ul className="space-y-2 mb-6 text-black">
                    {["25 Complete Tokens", "Scan Enemy Mines", "Speed run Sprinting", "Leaderboard Showcase", "100% Humanitarian Aid"].map((f, i) => (
                      <li key={i} className="flex items-center gap-2 p-1.5 bg-blue-50 rounded-lg border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-[11px] font-bold">
                        <span className="w-4 h-4 rounded-md bg-blue-500 text-white flex items-center justify-center text-[9px] border border-black">✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
                <button 
                  onClick={() => buyTokens(25)}
                  className="w-full py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-black text-xs border-3 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer rounded-xl uppercase"
                >
                  Get 25 Tokens for $25 &rarr;
                </button>
              </motion.div>

              {/* Enterprise / Tycoon Pack */}
              <motion.div
                whileHover={{ rotate: -1, scale: 1.02 }}
                className="bg-white rounded-2xl p-6 border-3 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl font-black text-black">Tycoon Pack</h3>
                    <span className="px-3 py-1 bg-purple-500 text-white font-black text-[9px] rounded-lg border-2 border-black uppercase">
                      SUPREME
                    </span>
                  </div>
                  <ul className="space-y-2 mb-6 text-black">
                    {["100 Massive Tokens", "Infinite Map Influence", "Humanitarian Aid Hall candidate", "24/7 Strategic Respect"].map((f, i) => (
                      <li key={i} className="flex items-center gap-2 p-1.5 bg-purple-50 rounded-lg border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] text-[11px] font-bold">
                        <span className="w-4 h-4 rounded-md bg-purple-500 text-white flex items-center justify-center text-[9px] border border-black">✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
                <button 
                  onClick={() => buyTokens(100)}
                  className="w-full py-2.5 bg-purple-500 hover:bg-purple-600 text-white font-black text-xs border-3 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer rounded-xl uppercase"
                >
                  Get 100 Tokens for $100 &rarr;
                </button>
              </motion.div>
            </div>

            <div className="text-center mt-8">
              <button 
                onClick={() => setIsPurchaseModalOpen(false)}
                className="text-black/50 hover:text-black font-black text-[10px] uppercase tracking-wider underline cursor-pointer"
              >
                Maybe Later, Let's Watch
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <div 
        ref={gridRef}
        className="relative flex-none origin-top-left bg-[#fffdfa] border-4 border-black rounded-3xl shadow-[12px_12px_0px_0px_#000]"
        style={{ 
          width: `${size * 4}px`,
          height: `${size * 4}px`,
          backgroundImage: 'linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)',
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

