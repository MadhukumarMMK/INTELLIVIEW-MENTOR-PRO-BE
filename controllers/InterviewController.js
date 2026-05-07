const Interview = require("../models/Interview");
const User = require("../models/user");
const AdminSettings = require("../models/AdminSettings");

// 1. CREATE (Start of Interview)
const createInterview = async (req, res) => {
  try {
    const { roll_no, technology_name, level, questions_count, mode, candidate_name } = req.body;

    // Fetch dynamic limit from admin settings
    const settings = await AdminSettings.findOne();
    const maxInterviews = settings?.max_interviews || 6;

    // Only completed + NOT archived interviews count toward the limit.
    // Archived interviews are preserved for history but free up a slot.
    const completedCount = await Interview.countDocuments({
      roll_no, status: 2, archived: { $ne: true }
    });
    if (completedCount >= maxInterviews) {
      return res.status(403).json({
        message: `Interview limit reached (${completedCount}/${maxInterviews}). Archive an old interview from My Reports to free a slot.`
      });
    }

    // Also clean up any stuck in-progress interviews (status=1) older than 2 hours
    await Interview.deleteMany({ roll_no, status: 1, start_date_time: { $lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });

    const newInterview = new Interview({
      roll_no,
      technology_name,
      level,
      questions_count,
      mode,
      start_date_time: new Date(),
      status: 1, // 1 = In Progress
      candidate_name: (candidate_name || "").toString().trim().slice(0, 60)
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
    const {
      question_details, emotions, overall_analysis, overall_score,
      total_time_taken, avg_time_per_question,
    } = req.body;

    const updateData = { status: 2 };
    if (question_details) {
      updateData.question_details = question_details;
      // Overwrite questions_count with the ACTUAL number asked — the create
      // step saves a placeholder because the mode-specific count isn't known
      // there, but by this point we have the real answered list.
      updateData.questions_count = String(question_details.length);
    }
    if (emotions) updateData.emotions = emotions;
    if (overall_analysis) updateData.overall_analysis = overall_analysis;
    if (overall_score !== undefined) updateData.overall_score = overall_score;
    if (total_time_taken !== undefined) updateData.total_time_taken = total_time_taken;
    if (avg_time_per_question !== undefined) updateData.avg_time_per_question = avg_time_per_question;

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

// 5. DELETE — kept for admin/cleanup + aborted (status=1) interviews only
const deleteInterview = async (req, res) => {
  try {
    const { id } = req.params;
    await Interview.findByIdAndDelete(id);
    res.status(200).json({ message: "Interview deleted successfully. Slot freed." });
  } catch (error) {
    res.status(500).json({ message: "Error deleting interview" });
  }
};

// 6. ARCHIVE — soft-archive a completed interview so it no longer counts against the limit
const archiveInterview = async (req, res) => {
  try {
    const { id } = req.params;
    const interview = await Interview.findById(id);
    if (!interview) return res.status(404).json({ message: "Interview not found" });
    if (interview.archived) return res.status(400).json({ message: "Already archived" });

    interview.archived = true;
    interview.archived_at = new Date();
    await interview.save();
    res.status(200).json({ message: "Interview archived. Slot freed.", data: interview });
  } catch (error) {
    res.status(500).json({ message: "Error archiving interview", error: error.message });
  }
};

// 7. UNARCHIVE — restore an archived interview (blocked if user is at limit)
const unarchiveInterview = async (req, res) => {
  try {
    const { id } = req.params;
    const interview = await Interview.findById(id);
    if (!interview) return res.status(404).json({ message: "Interview not found" });
    if (!interview.archived) return res.status(400).json({ message: "Not archived" });

    // Check if user has capacity to bring this back into active slots
    const settings = await AdminSettings.findOne();
    const maxInterviews = settings?.max_interviews || 6;
    const activeCount = await Interview.countDocuments({
      roll_no: interview.roll_no, status: 2, archived: { $ne: true }
    });

    if (activeCount >= maxInterviews) {
      return res.status(403).json({
        message: `You're at your interview limit (${activeCount}/${maxInterviews}). Archive another interview first to make room.`
      });
    }

    // Proper unset so the field is actually removed from the document.
    const updated = await Interview.findByIdAndUpdate(
      id,
      { $set: { archived: false }, $unset: { archived_at: "" } },
      { new: true }
    );
    res.status(200).json({ message: "Interview restored to active.", data: updated });
  } catch (error) {
    res.status(500).json({ message: "Error unarchiving interview", error: error.message });
  }
};

module.exports = {
  createInterview,
  updateInterviewResults,
  getInterviewReport,
  getUserHistory,
  deleteInterview,
  archiveInterview,
  unarchiveInterview
};