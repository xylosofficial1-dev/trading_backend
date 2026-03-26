// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

// store connected users
const onlineUsers = {};

// SOCKET CONNECTION
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("register", (userId) => {
    onlineUsers[userId] = socket.id;
    console.log("Registered:", userId);
  });

  socket.on("disconnect", () => {
    for (let id in onlineUsers) {
      if (onlineUsers[id] === socket.id) {
        delete onlineUsers[id];
        console.log("User disconnected:", id);
      }
    }
  });
});

// make io available in routes
app.set("io", io);
app.set("onlineUsers", onlineUsers);

// ROUTES
const transactionsRoute = require("./routes/transactions");
const authRoutes = require("./routes/authRoutes");
const passwordResetRoutes = require("./routes/passwordResetRoutes");
const userRoutes = require("./routes/userRoutes");
const notifications = require("./routes/notifications");
const tradeRoutes = require("./routes/trades");
const systemRoutes = require("./routes/userSystemRoutes");
const mpinRoutes = require("./routes/mpinRoutes");
const mpinForgotRoutes = require("./routes/mpinForgotRoutes");
const adminDataRoutes = require("./routes/adminDataRoutes");
const swapRoutes = require("./routes/swapRoutes");
const supportRoutes = require("./routes/supportRoutes");
const withdrawalRoutes = require("./routes/withdrawalRoutes");
const marketRoutes = require("./routes/marketRoutes");

const { router: p2pRoutes, checkExpiredTrades } = require("./routes/p2pRoutes");
 
// USE ROUTES
app.use("/api/transactions", transactionsRoute);
app.use("/api/auth", authRoutes);
app.use("/api/password", passwordResetRoutes);
app.use("/api", userRoutes);
app.use("/api/notifications", notifications);
app.use("/api/trades", tradeRoutes);
app.use("/api/system", systemRoutes);
app.use("/api/mpin", mpinRoutes);
app.use("/api/mpin/forgot", mpinForgotRoutes);
app.use("/api/p2p", p2pRoutes);
app.use("/api/admin", adminDataRoutes);
app.use("/api/swap", swapRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/withdrawal", withdrawalRoutes);
app.use("/api/market", marketRoutes);

app.use("/api/pay-options", require("./routes/payOptionsRoutes"));
app.use("/api/payments", require("./routes/paymentRequestRoutes"));
app.use("/api/admin/market", require("./routes/adminMarketRoutes"));
app.use("/api/wallet", require("./routes/walletRoutes"));
app.use("/api/topics", require("./routes/topicRoutes"));
app.use("/api/videos", require("./routes/videoRoutes"));
app.use("/api/referral-task", require("./routes/referralTaskIncomeRoutes"));
app.use("/api/test", require("./routes/testRoutes"));
app.use("/api/monthly-salary", require("./routes/monthlySalaryRoutes"));
app.use("/api/admin-income", require("./routes/adminIncomeRoutes"));

// Check expired trades every minute
setInterval(() => {
  checkExpiredTrades(io, onlineUsers);
}, 60000);

// START SERVER
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});