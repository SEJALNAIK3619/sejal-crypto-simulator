import express from "express";
import fs from "node:fs";
import path from "node:path";
import { latestTrade } from "./index.js";

const app = express();
app.use(express.json());

const DB_PATH = path.join(__dirname, "../data/database.json");
const INR_CONVERSION_RATE = 83;

interface TradeRecord {
  tradeId: string; symbol: string; side: "LONG" | "SHORT"; leverage: number; marginAmount: number; entryPriceINR: number; timestamp: number; status: "OPEN" | "CLOSED"; exitPriceINR?: number; realizedPnLINR?: number;
}
interface UserAccount {
  balanceINR: number; openTrades: TradeRecord[]; closedTrades: TradeRecord[];
}

const readDB = (): { users: Record<string, UserAccount> } => JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
const writeDB = (data: any) => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));

app.post("/api/user/setup", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  const db = readDB();
  db.users[email] = { balanceINR: 1000000, openTrades: [], closedTrades: [] };
  writeDB(db);

  return res.status(200).json({ message: "Account setup successful", balanceINR: 1000000 });
});

app.post("/api/trade/open", (req, res) => {
  const { email, symbol, side, leverage, marginAmount } = req.body;
  if (symbol !== "BTCUSDT") return res.status(400).json({ error: "Only BTCUSDT is supported" });
  if (!latestTrade) return res.status(503).json({ error: "Market feed warming up. Try again." });

  const db = readDB();
  const user = db.users[email];
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.balanceINR < marginAmount) return res.status(400).json({ error: "Insufficient INR balance" });

  const entryPriceINR = latestTrade.price * INR_CONVERSION_RATE;
  const newTrade: TradeRecord = {
    tradeId: `trade-${Date.now()}`, symbol, side, leverage, marginAmount, entryPriceINR, timestamp: Date.now(), status: "OPEN"
  };

  user.balanceINR -= marginAmount;
  user.openTrades.push(newTrade);
  writeDB(db);

  return res.status(200).json({ message: "Trade opened successfully", trade: newTrade, executionPriceINR: entryPriceINR });
});

app.post("/api/trade/close", (req, res) => {
  const { email, tradeId } = req.body;
  if (!latestTrade) return res.status(503).json({ error: "Market feed offline" });

  const db = readDB();
  const user = db.users[email];
  if (!user) return res.status(404).json({ error: "User not found" });

  const tradeIndex = user.openTrades.findIndex(t => t.tradeId === tradeId);
  if (tradeIndex === -1) return res.status(404).json({ error: "Active trade not found" });

  const trade = user.openTrades[tradeIndex];
  const currentPriceINR = latestTrade.price * INR_CONVERSION_RATE;
  
  let priceChangePct = (currentPriceINR - trade.entryPriceINR) / trade.entryPriceINR;
  if (trade.side === "SHORT") priceChangePct = -priceChangePct;

  let rawPnL = trade.marginAmount * priceChangePct * trade.leverage;
  if (rawPnL < -trade.marginAmount) rawPnL = -trade.marginAmount;

  trade.status = "CLOSED";
  trade.exitPriceINR = currentPriceINR;
  trade.realizedPnLINR = rawPnL;

  user.balanceINR += (trade.marginAmount + rawPnL);
  user.closedTrades.push(trade);
  user.openTrades.splice(tradeIndex, 1);
  writeDB(db);

  return res.status(200).json({ message: "Trade settled", profitOrLossINR: rawPnL, finalBalanceINR: user.balanceINR });
});

app.get("/api/trade/history", (req, res) => {
  const email = req.query.email as string;
  if (!email) return res.status(400).json({ error: "Email parameter required" });

  const db = readDB();
  const user = db.users[email];
  if (!user) return res.status(404).json({ error: "User account not found" });

  return res.status(200).json({ balanceINR: user.balanceINR, openPositions: user.openTrades, history: user.closedTrades });
});

export default app;
