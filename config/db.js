const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.error("❌ MONGO_URI is not set in backend/.env");
    process.exit(1);
  }

  // Observability: log connection state changes so failures aren't silent
  mongoose.connection.on("connected", () => console.log("✅ MongoDB connected"));
  mongoose.connection.on("disconnected", () => console.warn("⚠️  MongoDB disconnected"));
  mongoose.connection.on("reconnected", () => console.log("🔄 MongoDB reconnected"));
  mongoose.connection.on("error", (err) => console.error("🔴 MongoDB error:", err.message));

  try {
    // serverSelectionTimeoutMS: fail fast if Atlas cluster is paused / IP not whitelisted
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 8000
    });
  } catch (error) {
    console.error("❌ MongoDB connect failed:", error.message);
    console.error("   Hints:");
    console.error("   - Is your Atlas cluster running? (free tier auto-pauses)");
    console.error("   - Is your IP whitelisted in Atlas > Network Access?");
    console.error("   - Is MONGO_URI correct (user/password/cluster URL)?");
    process.exit(1);
  }
};

module.exports = connectDB;