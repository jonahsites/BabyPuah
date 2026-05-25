import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config();

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Helper to get fully qualified base URL safely
function getBaseUrl(req: express.Request): string {
  // 1. Try Origin header
  const origin = req.get("origin");
  if (origin && origin !== "null" && origin.startsWith("http")) {
    return origin.replace(/\/$/, "");
  }

  // 2. Try Referer header (extract protocol + host)
  const referer = req.get("referer");
  if (referer && referer.startsWith("http")) {
    try {
      const url = new URL(referer);
      return url.origin;
    } catch (_) {}
  }

  // 3. Fallback to host headers
  const forwardedProto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = req.get("host") || "localhost:3000";
  return `${forwardedProto}://${host}`.replace(/\/$/, "");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Disable X-Powered-By header to prevent technology stack fingerprinting
  app.disable("x-powered-by");

  // In-memory rate limiting map
  const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
  const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
  const RATE_LIMIT_MAX_REQUESTS = 300; // Limit to 300 requests/min per IP to fully support fast polling and game updates safely

  // Periodically clean up expired rate limiting entries
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimitMap.entries()) {
      if (now > data.resetTime) {
        rateLimitMap.delete(ip);
      }
    }
  }, 180000); // Check every 3 minutes

  app.use(express.json());

  // Unified Security & Protection Middleware
  app.use((req, res, next) => {
    // 1. IP-Based Rate Limiting Protection
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "anonymous";
    const now = Date.now();

    let limitData = rateLimitMap.get(ip);
    if (!limitData || now > limitData.resetTime) {
      limitData = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
      rateLimitMap.set(ip, limitData);
    }

    limitData.count++;

    // Express standard limit tracking headers
    res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, RATE_LIMIT_MAX_REQUESTS - limitData.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(limitData.resetTime / 1000));

    if (limitData.count > RATE_LIMIT_MAX_REQUESTS) {
      return res.status(429).json({
        error: "Too Many Requests",
        message: "You are issuing requests too fast. Please take a slight breather and try again in a moment.",
      });
    }

    // 2. Strict & Restrictive Cross-Origin Resource Sharing (CORS) Configuration
    const allowedOrigins = [
      "https://ai.studio",
      "https://studio.google.com",
      "https://localhost:3000",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ];

    const origin = req.headers.origin;
    if (origin) {
      const isAllowed = allowedOrigins.includes(origin) || 
        origin.endsWith(".google.com") || 
        origin.endsWith(".run.app") || 
        origin.endsWith(".googleusercontent.com");

      if (isAllowed) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "X-Requested-With,Content-Type,Authorization");

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    // 3. Robust Content Security Policy (CSP) & Client Security Protocols
    const csp = [
      "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval' wss:;",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com https://js.stripe.com;",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com;",
      "font-src 'self' https://fonts.gstatic.com data:;",
      "img-src 'self' data: https:;",
      "connect-src 'self' https: wss:;",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.firebaseapp.com https://*.google.com;",
      "frame-ancestors 'self' https://*.google.com https://*.run.app https://ai.studio https://*.studio.google.com https://*.googleusercontent.com;"
    ].join(" ");

    res.setHeader("Content-Security-Policy", csp);

    // Prevents Clickjacking Vulnerabilities
    res.setHeader("X-Frame-Options", "SAMEORIGIN");

    // Prevents Mime-Type Sniffing Exploits
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Enforces HTTPS Connection Security (HSTS)
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");

    // Restricts Referrer Leaks
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    // Demarcates Allowed Browser Hardware & Privacy Sensors
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");

    next();
  });

  // Health check endpoints for orchestration
  app.get(["/health", "/healthz", "/api/health"], (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  // API Route: Configuration Status
  app.get("/api/config-status", (req, res) => {
    res.json({
      stripeEnabled: !!stripe,
      hasSecretKey: !!process.env.STRIPE_SECRET_KEY,
    });
  });

  // API Route: Create Checkout Session
  app.post("/api/create-checkout-session", async (req, res) => {
    const { tokens, userId } = req.body;

    // Strict input schema validation to prevent payload manipulation
    const parsedTokens = Number(tokens);
    if (tokens === undefined || tokens === null || isNaN(parsedTokens) || parsedTokens <= 0 || parsedTokens > 10000 || !Number.isInteger(parsedTokens)) {
      return res.status(400).json({ error: "Invalid request data", message: "Token quantity must be a positive integer between 1 and 10,000." });
    }
    if (typeof userId !== "string" || !userId || userId.trim().length === 0 || userId.length > 128) {
      return res.status(400).json({ error: "Invalid request data", message: "User identifier must be a valid, non-empty string under 128 characters." });
    }

    const sanitizedUserId = userId.trim();
    const baseUrl = getBaseUrl(req);

    if (!stripe) {
      // Sandbox Checkout Simulation Mode
      const mockSessionId = `mock_session_${Date.now()}_u_${sanitizedUserId}_t_${parsedTokens}`;
      const mockSessionUrl = `${baseUrl}/?payment=success&session_id=${mockSessionId}&sandbox=true`;
      return res.json({ id: mockSessionId, url: mockSessionUrl });
    }
    
    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `${parsedTokens} Game Tokens`,
                description: "Purchase tokens for Territory War",
              },
              unit_amount: parsedTokens * 100, // $1 per token
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${baseUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/?payment=cancel`,
        metadata: {
          userId: sanitizedUserId,
          tokens: parsedTokens.toString(),
        },
      });

      res.json({ id: session.id, url: session.url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API Route: Verify Payment (Simplified for this environment)
  app.get("/api/verify-payment", async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "Missing session_id" });

    // Handle Mock Sandbox Sessions
    if (typeof session_id === "string" && session_id.startsWith("mock_session_")) {
      const match = session_id.match(/_u_(.*)_t_(\d+)/);
      if (match) {
        const userId = match[1];
        const tokens = parseInt(match[2]);
        return res.json({ 
          status: "paid", 
          tokens,
          userId,
          isSandbox: true
        });
      }
    }

    if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

    try {
      const session = await stripe.checkout.sessions.retrieve(session_id as string);
      if (session.payment_status === "paid") {
        res.json({ 
          status: "paid", 
          tokens: parseInt(session.metadata?.tokens || "0"),
          userId: session.metadata?.userId 
        });
      } else {
        res.json({ status: "unpaid" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
