const express = require("express");
const Router = express.Router();
const multer = require("multer");
const UserController = require("../controllers/UserController");
const User = require("../models/user"); 

// --- 1. Storage Configuration (Goal #1 & #8) ---

// Resume storage for initial onboarding
const resumeStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/resumes/"),
  filename: (req, file, cb) => cb(null, `resume-${Date.now()}-${file.originalname}`)
});

// Professional certificate storage for user profiles
const certStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/certs/'),
  filename: (req, file, cb) => cb(null, `cert-${Date.now()}-${file.originalname}`)
});

const uploadResume = multer({ storage: resumeStorage });
const uploadCert = multer({ storage: certStorage });

// --- 2. Authentication & Onboarding Routes ---

// Login Endpoint (Handles singular /api/user/login)
Router.post("/login", UserController.loginUser);

// Resume Upload & NLP Extraction (Goal #1)
Router.post("/upload-resume", uploadResume.single("file"), UserController.uploadAndParseResume);

// --- 3. Profile Management Routes (Goal #8) ---

// DigiLocker — Certificate Upload
Router.post("/upload-certification", uploadCert.single("certificate"), async (req, res) => {
  try {
    const { roll_no, cert_name } = req.body;

    if (!req.file) return res.status(400).json({ message: "No file provided" });
    if (!roll_no) return res.status(400).json({ message: "Roll number required" });

    const certData = {
      id: Date.now().toString(),
      name: cert_name || req.file.originalname,
      filename: req.file.filename,
      path: req.file.path,
      url: `/uploads/certs/${req.file.filename}`,
      type: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date()
    };

    const updatedUser = await User.findOneAndUpdate(
      { roll_no },
      { $push: { certifications: certData } },
      { new: true }
    );

    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    res.json({ message: "Certificate uploaded", certifications: updatedUser.certifications });
  } catch (err) {
    console.error("Certificate Upload Error:", err.message);
    res.status(500).json({ message: "Failed to upload certificate", error: err.message });
  }
});

// DigiLocker — Delete Certificate
Router.delete("/certification/:roll_no/:cert_id", async (req, res) => {
  try {
    const { roll_no, cert_id } = req.params;
    const user = await User.findOne({ roll_no });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Find and remove the cert
    const cert = user.certifications.find(c => c.id === cert_id);
    if (cert && cert.path) {
      const fs = require("fs");
      if (fs.existsSync(cert.path)) fs.unlinkSync(cert.path);
    }

    user.certifications = user.certifications.filter(c => c.id !== cert_id);
    await user.save();

    res.json({ message: "Certificate deleted", certifications: user.certifications });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete certificate" });
  }
});

// --- 4. Profile Routes ---

// Profile picture storage
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/avatars/"),
  filename: (req, file, cb) => cb(null, `avatar-${Date.now()}-${file.originalname}`)
});
const uploadAvatar = multer({ storage: avatarStorage });

// Get user profile
Router.get("/profile/:roll_no", async (req, res) => {
  try {
    const user = await User.findOne({ roll_no: req.params.roll_no }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error fetching profile" });
  }
});

// PUBLIC shareable profile view — anyone with the link can see basic info +
// completed NON-ARCHIVED interview reports. No auth required.
// NOTE: returns a curated safe projection — no email/phone/mobile leaked
// unless the user explicitly chose to make those public.
Router.get("/public-profile/:roll_no", async (req, res) => {
  try {
    const Interview = require("../models/Interview");
    const user = await User.findOne({ roll_no: req.params.roll_no })
      .select("first_name roll_no college branch passout_year profile_picture github_url linkedin_url skills certifications");
    if (!user) return res.status(404).json({ message: "Profile not found" });

    // Only completed + non-archived reports
    const interviews = await Interview.find({
      roll_no: req.params.roll_no,
      status: 2,
      archived: { $ne: true }
    })
      .select("technology_name level overall_score question_details mode createdAt")
      .sort({ createdAt: -1 });

    res.json({
      user: {
        first_name: user.first_name || "Anonymous",
        roll_no: user.roll_no,
        college: user.college,
        branch: user.branch,
        passout_year: user.passout_year,
        profile_picture: user.profile_picture,
        github_url: user.github_url,
        linkedin_url: user.linkedin_url,
        skills: user.skills || [],
        certifications_count: (user.certifications || []).length
      },
      interviews: interviews.map(i => ({
        _id: i._id,
        technology_name: i.technology_name,
        level: i.level,
        overall_score: i.overall_score,
        questions_count: (i.question_details || []).length,
        mode: i.mode,
        createdAt: i.createdAt
      }))
    });
  } catch (err) {
    console.error("Public profile error:", err);
    res.status(500).json({ message: "Error fetching public profile" });
  }
});

// Update profile details
Router.put("/profile/:roll_no", async (req, res) => {
  try {
    const { first_name, email, mobile_number, college, branch, passout_year, bio, github_url, linkedin_url } = req.body;
    const updated = await User.findOneAndUpdate(
      { roll_no: req.params.roll_no },
      { $set: { first_name, email, mobile_number, college, branch, passout_year, bio, github_url, linkedin_url, updated_at: new Date() } },
      { new: true }
    ).select("-password");
    res.json({ message: "Profile updated", user: updated });
  } catch (err) {
    res.status(500).json({ message: "Error updating profile" });
  }
});

// Upload profile picture
Router.post("/upload-avatar", uploadAvatar.single("avatar"), async (req, res) => {
  try {
    const { roll_no } = req.body;
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const updated = await User.findOneAndUpdate(
      { roll_no },
      { profile_picture: `/uploads/avatars/${req.file.filename}` },
      { new: true }
    ).select("-password");
    res.json({ message: "Avatar uploaded", user: updated });
  } catch (err) {
    res.status(500).json({ message: "Error uploading avatar" });
  }
});

// DEPRECATED alias kept for backward compatibility — routes through the real
// parser so callers that still hit /upload-resume-file get correct behavior
// (skills extracted, old file cleaned up).
Router.post("/upload-resume-file", uploadResume.single("file"), UserController.uploadAndParseResume);

// Download resume
Router.get("/download-resume/:roll_no", async (req, res) => {
  try {
    const user = await User.findOne({ roll_no: req.params.roll_no });
    if (!user || !user.resume_path) return res.status(404).json({ message: "No resume found" });
    const path = require("path");
    const fs = require("fs");
    const fullPath = path.resolve(user.resume_path);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ message: "Resume file not found" });
    res.download(fullPath);
  } catch (err) {
    res.status(500).json({ message: "Error downloading resume" });
  }
});

// --- 5. Change Password ---
const bcrypt = require("bcryptjs");

Router.put("/change-password", async (req, res) => {
  try {
    const { roll_no, current_password, new_password } = req.body;
    if (!roll_no || !current_password || !new_password) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({ roll_no });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Verify current password (support both plain and hashed)
    const isMatch = (current_password === user.password) || (await bcrypt.compare(current_password, user.password));
    if (!isMatch) return res.status(401).json({ message: "Current password is incorrect" });

    const hashedPwd = await bcrypt.hash(new_password, 10);
    await User.findOneAndUpdate({ roll_no }, { password: hashedPwd });

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to change password" });
  }
});

module.exports = Router;