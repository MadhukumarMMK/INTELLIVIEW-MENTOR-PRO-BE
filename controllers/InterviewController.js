const Interview = require("../models/Interview");
const User = require("../models/user");
const AdminSettings = require("../models/AdminSettings");

// 1. CREATE (Start of Interview)
const createInterview = async (req, res) => {
  try {
    const { roll_no, technology_name, level, questions_count } = req.body;

    // Fetch dynamic limit from admin settings
    const settings = await AdminSettings.findOne();
    const maxInterviews = settings?.max_interviews || 6;

    // Only completed interviews (status=2) count toward the limit
    // In-progress or abandoned interviews don't consume the limit
    const completedCount = await Interview.countDocuments({ roll_no, status: 2 });
    if (completedCount >= maxInterviews) {
      return res.status(403).json({
        message: `Interview limit reached (${completedCount}/${maxInterviews}). You have completed the maximum allowed interviews.`
      });
    }

    // Also clean up any stuck in-progress interviews (status=1) older than 2 hours
    await Interview.deleteMany({ roll_no, status: 1, start_date_time: { $lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });

    const newInterview = new Interview({
      roll_no,
      technology_name,
      level,
      questions_count,
      start_date_time: new Date(),
      status: 1 // 1 = In Progress
    });

    const savedInterview = await newInterview.save();
    res.status(201).json({ message: "Interview created successfully", data: savedInterview });
  } catch (error) {
    res.status(500).json({ message: "Error scheduling interview", error: error.message });
  }
};

// 2. UPDATE (End of Interview - SAVING AI RESULTS)
const updateInterviewResults = async (req, res) => {
  try {
    const { id } = req.params;
    const { question_details, emotions, overall_analysis, overall_score } = req.body;

    const updateData = { status: 2 };
    if (question_details) updateData.question_details = question_details;
    if (emotions) updateData.emotions = emotions;
    if (overall_analysis) updateData.overall_analysis = overall_analysis;
    if (overall_score !== undefined) updateData.overall_score = overall_score;

    const updatedInterview = await Interview.findByIdAndUpdate(
      id,
      updateData,
      { returnDocument: 'after' }
    );

    if (!updatedInterview) return res.status(404).json({ message: "Interview not found" });

    res.status(200).json({ message: "Interview results saved", data: updatedInterview });
  } catch (error) {
    res.status(500).json({ message: "Error saving results", error: error.message });
  }
};

// 3. GET SINGLE REPORT (For the Report Page)
const getInterviewReport = async (req, res) => {
  try {
    const { id } = req.params;
    const report = await Interview.findById(id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    
    res.status(200).json(report);
  } catch (error) {
    res.status(500).json({ message: "Error fetching report" });
  }
};

// 4. GET HISTORY (For Dashboard)
// Fetch all interviews for a specific user (Goal #7) 
const getUserHistory = async (req, res) => {
  try {
    const { roll_no } = req.params;
    
    // Find interviews, sort by most recent (Goal #6) 
    const history = await Interview.find({ roll_no }).sort({ start_date_time: -1 });
    
    if (!history || history.length === 0) {
      return res.status(200).json([]); // Return empty array so frontend doesn't crash
    }
    
    res.status(200).json(history);
  } catch (error) {
    console.error("History API Error:", error.message);
    res.status(500).json({ message: "Error fetching interview history" });
  }
};

// 5. DELETE
const deleteInterview = async (req, res) => {
  try {
    const { id } = req.params;
    await Interview.findByIdAndDelete(id);
    res.status(200).json({ message: "Interview deleted successfully. Slot freed." });
  } catch (error) {
    res.status(500).json({ message: "Error deleting interview" });
  }
};

module.exports = { 
  createInterview, 
  updateInterviewResults, 
  getInterviewReport, 
  getUserHistory, 
  deleteInterview 
};