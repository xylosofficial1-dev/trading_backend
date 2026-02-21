require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ROUTES
const transactionsRoute = require("./routes/transactions");
const authRoutes = require("./routes/authRoutes");
const passwordResetRoutes = require("./routes/passwordResetRoutes");
const userRoutes = require("./routes/userRoutes");
const notifications = require("./routes/notifications");
const tradeRoutes = require("./routes/trades");
const systemRoutes = require("./routes/userSystemRoutes");

// USE ROUTES
app.use("/api/transactions", transactionsRoute);
app.use("/api/auth", authRoutes);
app.use("/api/password", passwordResetRoutes);
app.use("/api", userRoutes);
app.use("/api/notifications", notifications);
app.use("/api/trades", tradeRoutes);

app.use("/api/pay-options", require("./routes/payOptionsRoutes"));
app.use("/api/payments", require("./routes/paymentRequestRoutes"));
app.use("/api/admin/market", require("./routes/adminMarketRoutes"));

app.use("/api/wallet", require("./routes/walletRoutes"));
app.use("/api/topics", require("./routes/topicRoutes"));
app.use("/api/videos", require("./routes/videoRoutes"));
app.use("/api/commission", require("./routes/commissionEngine"));


app.use("/api/system", systemRoutes);

// START SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

require("./jobs/commissionJob");