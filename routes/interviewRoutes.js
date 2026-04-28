const express = require("express");
const router = express.Router();
const {
  createInterview,
  updateInterviewResults,
  getInterviewReport,
  getUserHistory,
  deleteInterview,
  archiveInterview,
  unarchiveInterview
} = require("../controllers/InterviewController");
const adaptiveController = require("../controllers/adaptiveController");

router.post("/create", createInterview);
router.put("/update/:id", updateInterviewResults); // <--- For saving final results
router.get("/report/:id", getInterviewReport);     // <--- For the Report page
router.get("/history/:roll_no", getUserHistory);
router.delete("/delete/:id", deleteInterview);       // kept for aborted/in-progress cleanup
router.put("/archive/:id", archiveInterview);        // soft archive — frees a slot
router.put("/unarchive/:id", unarchiveInterview);    // restore — blocked if user is at limit
router.post("/adaptive-step", adaptiveController.getNextQuestion);

// Proxy: initial question generation to Python engine
const axios = require("axios");
router.post("/generate-questions", async (req, res) => {
  try {
    const pythonUrl = process.env.PYTHON_ENGINE_URL || "http://localhost:5002";
    const response = await axios.post(`${pythonUrl}/api/generate-questions`, req.body, { timeout: 60000 });
    res.json(response.data);
  } catch (err) {
    console.error("Python generate-questions proxy error:", err.message);
    res.status(502).json({ error: "AI Engine unavailable", data: { questions: ["Explain the core architecture of your primary technology stack."] } });
  }
});

module.exports = router;