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

  app.use(express.json());

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
    const baseUrl = getBaseUrl(req);

    if (!stripe) {
      // Sandbox Checkout Simulation Mode
      const mockSessionId = `mock_session_${Date.now()}_u_${userId}_t_${tokens}`;
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
                name: `${tokens} Game Tokens`,
                description: "Purchase tokens for Territory War",
              },
              unit_amount: tokens * 100, // $1 per token
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${baseUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/?payment=cancel`,
        metadata: {
          userId,
          tokens: tokens.toString(),
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
