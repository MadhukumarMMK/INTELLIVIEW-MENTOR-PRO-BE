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
// maxHttpBufferSize bumped to 10MB to allow audio base64 payloads for SER model
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 10 * 1024 * 1024
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

// AUDIO_MODE: "real" sends audio binary (base64) for SER model inference (local)
//             "size" sends only byte count for heuristic (Render free tier)
const AUDIO_MODE = (process.env.AUDIO_MODE || "real").toLowerCase();
console.log(`Audio Mode: ${AUDIO_MODE}`);

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

      // 2. Combine audio chunks — always get size; base64 only in "real" mode
      let audioSize = 0;
      let audioBase64 = null;
      if (audioChunks.length > 0) {
        const combinedAudio = Buffer.concat(audioChunks);
        audioSize = combinedAudio.length;
        if (AUDIO_MODE === "real") {
          audioBase64 = combinedAudio.toString("base64");
          console.log(`Audio: ${audioChunks.length} chunks, ${audioSize} bytes → SER model`);
        } else {
          console.log(`Audio: ${audioChunks.length} chunks, ${audioSize} bytes → size heuristic`);
        }
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
        audio_size: audioSize,
        audio_base64: audioBase64,
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

      // 5. Bridge to Python Engine (with retry on timeout)
      let response;
      try {
        response = await axios.post(
          `${pythonEngineUrl}/api/generate-adaptive-step`,
          pythonPayload,
          { timeout: 60000 }
        );
      } catch (firstErr) {
        console.log("First attempt failed, retrying...", firstErr.message);
        response = await axios.post(
          `${pythonEngineUrl}/api/generate-adaptive-step`,
          pythonPayload,
          { timeout: 60000 }
        );
      }

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
        audio_emotion: response.data.audio_emotion,
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

// --- SOCIAL PREVIEW (Open Graph) for shared profile links ---
// LinkedIn / WhatsApp / Twitter bots crawl the URL and read <meta og:*> tags.
// React SPA's index.html is the same for every route, so the bot sees no
// useful preview. Here we serve a tiny HTML page (only when bot user-agent or
// when the request prefers HTML) that contains real OG tags scraped from
// MongoDB, then redirects browsers to the SPA route via JS.
app.get("/profile/share/:roll_no", async (req, res, next) => {
  const accept = (req.headers.accept || "").toLowerCase();
  const ua = (req.headers["user-agent"] || "").toLowerCase();
  // If this looks like a normal browser opening the page directly, fall through
  // to the SPA (the frontend dev server / static hosting handles the React route).
  // We intercept ONLY for crawler user-agents, OR when the response should be
  // an unauthenticated HTML preview (no Accept JSON). Browsers also benefit
  // since the same OG tags are read by their own preview cards.
  const isBot = /linkedin|facebook|whatsapp|twitter|slack|discord|telegram|preview|bot|crawler|spider/i.test(ua);
  if (!isBot && !accept.includes("text/html")) return next();

  try {
    const User = require("./models/user");
    const Interview = require("./models/Interview");
    const user = await User.findOne({ roll_no: req.params.roll_no })
      .select("first_name roll_no college branch profile_picture skills");

    if (!user) return next(); // let the SPA show the "not found" view

    const completed = await Interview.countDocuments({
      roll_no: req.params.roll_no, status: 2, archived: { $ne: true }
    });
    const best = await Interview.findOne({
      roll_no: req.params.roll_no, status: 2, archived: { $ne: true }
    }).sort({ overall_score: -1 }).select("overall_score");

    const bestScore = best ? Math.round(best.overall_score || 0) : 0;
    const skillsLine = (user.skills || []).slice(0, 5).join(", ");
    const title = `${user.first_name || user.roll_no} · IntelliView Interview Profile`;
    const description = `${user.first_name || "Candidate"} · ${user.college || "Student"}${user.branch ? " (" + user.branch + ")" : ""} · ${completed} mock interviews · Best score ${bestScore}%${skillsLine ? " · Skills: " + skillsLine : ""}`;
    const fullUrl = `${req.protocol}://${req.get("host")}/profile/share/${req.params.roll_no}`;
    const imageUrl = user.profile_picture
      ? `${req.protocol}://${req.get("host")}${user.profile_picture}`
      : `${req.protocol}://${req.get("host")}/og-default.png`;

    const escape = (s) => String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));

    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}" />

  <!-- Open Graph (LinkedIn, Facebook, WhatsApp) -->
  <meta property="og:title" content="${escape(title)}" />
  <meta property="og:description" content="${escape(description)}" />
  <meta property="og:image" content="${escape(imageUrl)}" />
  <meta property="og:url" content="${escape(fullUrl)}" />
  <meta property="og:type" content="profile" />
  <meta property="og:site_name" content="IntelliView" />

  <!-- Twitter / X -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escape(title)}" />
  <meta name="twitter:description" content="${escape(description)}" />
  <meta name="twitter:image" content="${escape(imageUrl)}" />

  <!-- Browsers: redirect to the actual React app route -->
  <meta http-equiv="refresh" content="0; url=${escape(process.env.CLIENT_URL || "/")}/profile/share/${encodeURIComponent(req.params.roll_no)}" />
</head>
<body>
  <p>Loading IntelliView profile…</p>
  <script>window.location.replace(${JSON.stringify((process.env.CLIENT_URL || "/") + "/profile/share/" + req.params.roll_no)});</script>
</body>
</html>`);
  } catch (err) {
    console.error("OG preview error:", err.message);
    next();
  }
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`IntelliView Hub running on port ${PORT}`));
