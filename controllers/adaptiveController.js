const axios = require("axios");
// Legacy: OpenAI is no longer used — adaptive logic runs via WebSocket → Python (Groq)
// Keeping this controller for backwards compatibility with the REST route
let openai = null;
try {
  const OpenAI = require("openai");
  if (process.env.OPENAI_API_KEY) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch (_) {}

/**
 * Goal #4 & #10: Adaptive Logic for Multimodal Interview
 * This handles the bridge between OpenAI scoring and Python RL Engine.
 */
const getNextQuestion = async (req, res) => {
  const { 
    lastQuestion, 
    lastAnswer, 
    emotionData, 
    currentQuestionIndex, 
    totalQuestions,
    tech,
    difficulty,
    mode,
    history 
  } = req.body;

  try {
    // 1. Terminal Check: End interview if question limit reached
    if (currentQuestionIndex >= totalQuestions - 1) {
      return res.status(200).json({ nextQuestion: null, interviewComplete: true });
    }

    // 2. Cognitive Evaluation: Use GPT to score the answer (Mode-Aware & Theoretical-Only)
    let evalPrompt = "";
    if (mode === "HR" || mode === "HR Behavioral") {
      evalPrompt = `Evaluate this behavioral HR interview answer. Focus on communication, situational judgment, and clarity.
      Return STRICT JSON with 'accuracy' (0-100) and 'analysis' (string). 
      Question: "${lastQuestion}". Answer: "${lastAnswer}"`;
    } else {
      evalPrompt = `Evaluate this theoretical answer for a ${tech} interview (${mode} mode). 
      Strictly focus on conceptual depth, architecture, 'Why', and 'How'. DO NOT penalize for lack of code syntax or HTML/CSS.
      Return STRICT JSON with 'accuracy' (0-100) and 'analysis' (string). 
      Question: "${lastQuestion}". Answer: "${lastAnswer}"`;
    }

    const evalResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: evalPrompt }],
      response_format: { type: "json_object" }
    });
    
    const analyzed = JSON.parse(evalResponse.choices[0].message.content);

    // 3. Affective Analysis: Goal #10 & #20 Multimodal confidence
    // We combine Neutral and Happy scores to represent a "Confidence" metric
    const confidenceScore = (emotionData.neutral || 0) + (emotionData.happy || 0);

    // 4. ML Policy Engine Bridge: Call Python (Port 5002) for RL decision & Groq Generation
    // Passes the lastAnswer and history to ensure Conversational Continuity
    const mlResponse = await axios.post("http://127.0.0.1:5002/api/generate-adaptive-step", {
      roll_no: req.body.roll_no,
      accuracy: analyzed.accuracy,
      avg_confidence: confidenceScore,
      current_difficulty: difficulty,
      tech: tech,
      answer_text: lastAnswer, // Renamed to match the Python expected parameter
      history: history || [lastQuestion],
      mode: mode || "custom"
    });
    
    const { new_difficulty, next_question, feedback: mlFeedback } = mlResponse.data;

    // Note: Since Python (Groq Llama 3.3) generates the next_question per your manifest,
    // the redundant OpenAI generation step in Node.js has been removed to reduce latency.

    // 5. Return payload for the Frontend Socket to emit
    res.status(200).json({
      next_question: next_question || "Could you expand a bit on your previous points?",
      new_difficulty: new_difficulty,
      feedback: analyzed.analysis, // Detailed feedback for the report
      accuracy: analyzed.accuracy,
      interviewComplete: false,
    });

  } catch (error) {
    console.error("❌ Adaptive Engine Failed:", error.message);
    res.status(500).json({ message: "Failed to generate adaptive question step." });
  }
};

module.exports = { getNextQuestion };