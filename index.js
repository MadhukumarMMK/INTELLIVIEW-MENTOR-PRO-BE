const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const axios = require("axios");
const connectDB = require("./config/db");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

// Initialize Socket.io (Goal #10 & #20: Real-time Arena)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

connectDB();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// Ensure upload directories exist
const fs = require("fs");
["uploads", "uploads/resumes", "uploads/avatars", "uploads/certs"].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Goal #14: Admin Dynamic Configuration
const pythonEngineUrl = process.env.PYTHON_ENGINE_URL || "http://localhost:5002";

// --- WebSocket Logic (Multimodal Feedback Loop) ---
io.on("connection", (socket) => {
  console.log("Arena Connected:", socket.id);

  // Per-session buffers for multimodal analysis
  let confidenceBuffer = [];
  let audioChunks = [];

  socket.on("start_session", (data) => {
    console.log(`Interview Started | Roll No: ${data.roll_no} | Mode: ${data.mode}`);
    socket.join(data.roll_no);
  });

  // Real-time facial confidence stream from Face-API.js
  socket.on("facial_data", (data) => {
    if (data.confidence !== undefined) {
      confidenceBuffer.push(data.confidence);
    }
  });

  // Real-time audio chunks from MediaRecorder — streamed parallel to speech
  // This reduces latency: audio is already buffered when user clicks Submit
  socket.on("audio_chunk", (data) => {
    if (data && data.length > 0) {
      audioChunks.push(Buffer.from(data));
    }
  });

  socket.on("submit_multimodal_answer", async (payload) => {
    const wasSkipped = payload.was_skipped || payload.lastAnswer === "SKIPPED";
    const questionsAsked = payload.questionsAsked || 1;
    const totalQuestions = payload.totalQuestions || 3;

    console.log(`\n--- Adaptive Step ---`);
    console.log(`Question ${questionsAsked}/${totalQuestions} | Skipped: ${wasSkipped}`);
    console.log(`Answer: ${(payload.lastAnswer || "").substring(0, 80)}...`);

    try {
      // 1. Calculate average facial confidence from buffered stream
      const avgConfidence = confidenceBuffer.length > 0
        ? confidenceBuffer.reduce((a, b) => a + b) / confidenceBuffer.length
        : 50;

      // 2. Encode buffered audio for Librosa/CNN-LSTM analysis
      let audioBase64 = "";
      if (audioChunks.length > 0) {
        const combinedAudio = Buffer.concat(audioChunks);
        audioBase64 = combinedAudio.toString("base64");
        console.log(`Audio: ${audioChunks.length} chunks, ${combinedAudio.length} bytes`);
      }

      // 3. Clear buffers for next question
      confidenceBuffer = [];
      audioChunks = [];

      // 4. Build payload for Python Engine
      const pythonPayload = {
        roll_no: payload.roll_no,
        question: payload.lastQuestion || "",
        answer: payload.lastAnswer || "",
        difficulty: payload.difficulty || "Medium",
        avg_confidence: avgConfidence,
        audio_data: audioBase64,
        was_skipped: wasSkipped,
        tech: payload.tech || "General",
        module: payload.module || "",
        topic: payload.topic || "",
        mode: payload.mode || "custom",
        skills: payload.skills || [],
        history: payload.history || [],
        questions_asked: questionsAsked,
        total_questions: totalQuestions
      };

      // 5. Bridge to Python Engine
      const response = await axios.post(
        `${pythonEngineUrl}/api/generate-adaptive-step`,
        pythonPayload,
        { timeout: 60000 }
      );

      // 6. Check if this was the last question
      const isComplete = questionsAsked >= totalQuestions;

      // 7. Emit result back to frontend
      socket.emit("next_step_ready", {
        next_question: response.data.question,
        new_difficulty: response.data.new_difficulty,
        accuracy: response.data.last_score,
        feedback: response.data.feedback,
        fused_confidence: response.data.fused_confidence,
        audio_confidence: response.data.audio_confidence,
        is_complete: isComplete
      });

    } catch (err) {
      console.error("Python Engine Error:", err.message);
      socket.emit("error", { message: "AI Engine is offline or failed to process." });
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected from Arena.");
    confidenceBuffer = [];
    audioChunks = [];
  });
});

// --- API ROUTES ---
app.use("/api/user", require("./routes/userRoutes"));
app.use("/api/interviews", require("./routes/interviewRoutes"));
app.use("/api/general", require("./routes/generalRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`IntelliView Hub running on port ${PORT}`));
