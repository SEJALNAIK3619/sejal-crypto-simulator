import { createServer } from "node:http";
import app from "./app";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.env.PORT) || 3000;
const BINANCE_SYMBOL = "BTCUSDT";
const BINANCE_STREAM_URL = "wss://://binance.com";
const LOCAL_STREAM_PATH = "/api/ws";
const RECONNECT_MAX_DELAY_MS = 30000;

const server = createServer(app);
const clientWebSocketServer = new WebSocketServer({ server, path: LOCAL_STREAM_PATH });

interface BinanceTradeEvent {
  e: "trade"; s: string; t: number; p: string; q: string; T: number; m: boolean;
}

export interface MarketTrade {
  symbol: string; tradeId: number; price: number; quantity: number; tradeTime: number; buyerIsMaker: boolean;
}

// Exported global tracker for active trade rates
export let latestTrade: MarketTrade | undefined;
let binanceSocket: WebSocket | undefined;
let reconnectTimer: NodeJS.Timeout | undefined;
let reconnectAttempts = 0;
let shuttingDown = false;

function parseTrade(data: RawData): MarketTrade | undefined {
  try {
    const payload = JSON.parse(data.toString()) as Partial<BinanceTradeEvent>;
    const price = Number(payload.p);
    const quantity = Number(payload.q);
    
    if (payload.e === "trade" && payload.s === BINANCE_SYMBOL && !Number.isNaN(price)) {
      return {
        symbol: payload.s,
        tradeId: payload.t || 0,
        price,
        quantity: quantity || 0,
        tradeTime: payload.T || Date.now(),
        buyerIsMaker: !!payload.m,
      };
    }
  } catch { return undefined; }
  return undefined;
}

function connectToBinance(): void {
  if (shuttingDown) return;
  console.log(`🔌 Connecting to Binance Live Stream for ${BINANCE_SYMBOL}...`);
  const socket = new WebSocket(BINANCE_STREAM_URL);
  binanceSocket = socket;

  socket.on("open", () => {
    reconnectAttempts = 0;
    console.log(`✅ Connected to Binance Live Feed [${BINANCE_SYMBOL}]`);
  });

  socket.on("message", (data) => {
    const trade = parseTrade(data);
    if (trade) {
      latestTrade = trade;
      // Broadcast live to connected frontend sockets
      const msg = JSON.stringify({ type: "trade", data: trade });
      for (const client of clientWebSocketServer.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      }
    }
  });

  socket.on("close", () => {
    if (shuttingDown) return;
    const delay = Math.min(1000 * 2 ** reconnectAttempts, RECONNECT_MAX_DELAY_MS);
    reconnectAttempts++;
    console.log(`⚠️ Stream disconnected. Reconnecting in ${delay}ms...`);
    reconnectTimer = setTimeout(connectToBinance, delay);
  });

  socket.on("error", (err) => console.error("WS Error:", err.message));
}

// Local Database Initialization
const dataDir = path.join(__dirname, "../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "database.json");
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({ users: {} }, null, 2));

server.listen(port, () => {
  console.log(`🚀 Crypto API Online at http://localhost:${port}`);
  connectToBinance();
});
