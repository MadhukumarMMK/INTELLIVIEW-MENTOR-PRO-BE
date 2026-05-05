const User = require("../models/user");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

const loginUser = async (req, res) => {
    try {
        const { roll_no, password } = req.body;
        const user = await User.findOne({ roll_no });

        if (!user) return res.status(404).json({ message: "User not found" });

        // Goal #14: Support both hashed and plain text for smooth testing
        // For final demo, strictly use bcrypt.compare
        const isMatch = (password === user.password) || (await bcrypt.compare(password, user.password));
        
        if (!isMatch) return res.status(401).json({ message: "Invalid password" });

        const token = jwt.sign(
            { id: user._id, roll_no: user.roll_no, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.TOKEN_EXPIRY || "8h" }
        );

        res.status(200).json({ message: "Login successful", user, token });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

const uploadAndParseResume = async (req, res) => {
    try {
        const { roll_no } = req.body;

        if (!roll_no) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({ message: "Roll number is required." });
        }

        if (!req.file) return res.status(400).json({ message: "No resume uploaded." });

        const existingUser = await User.findOne({ roll_no });
        if (!existingUser) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ message: "User not found." });
        }

        // ===== STEP 1: Call Python parser =====
        // Errors here = Python is down / unreachable / returned junk.
        let extractedData;
        try {
            const formData = new FormData();
            formData.append('file', fs.createReadStream(req.file.path), req.file.originalname);
            const pythonUrl = process.env.PYTHON_ENGINE_URL || 'http://localhost:5002';
            const nlpResponse = await axios.post(
                `${pythonUrl}/api/extract-resume`,
                formData,
                { headers: { ...formData.getHeaders() }, timeout: 30000 }
            );
            extractedData = nlpResponse.data.data;
            if (!extractedData) throw new Error("Parser returned no data");
        } catch (pyErr) {
            console.error("Python Bridge Error:", pyErr.message);
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch (_) {}
            }
            return res.status(503).json({
                message: "Resume parser is unavailable. Please try again shortly."
            });
        }

        // ===== STEP 2: Cleanup old resume file (parse succeeded) =====
        if (existingUser.resume_path && existingUser.resume_path !== req.file.path) {
            try {
                if (fs.existsSync(existingUser.resume_path)) {
                    fs.unlinkSync(existingUser.resume_path);
                }
            } catch (cleanupErr) {
                console.warn("Could not remove previous resume:", cleanupErr.message);
            }
        }

        // ===== STEP 3: Build safe update fields =====
        const updateFields = {
            skills: extractedData.skills || [],
            resume_path: req.file.path,
            mobile_number: extractedData.mobile_number || existingUser.mobile_number || "",
        };

        if (extractedData.name)     updateFields.first_name   = extractedData.name;
        if (extractedData.github)   updateFields.github_url   = extractedData.github;
        if (extractedData.linkedin) updateFields.linkedin_url = extractedData.linkedin;

        // Email is unique-indexed in the User schema. If the resume's email
        // differs from the user's CURRENT email AND already belongs to
        // someone else, skip the update — better to keep the old email than
        // crash the whole request with a duplicate-key error.
        if (extractedData.email) {
            const newEmail = String(extractedData.email).toLowerCase().trim();
            const currentEmail = (existingUser.email || "").toLowerCase().trim();
            if (newEmail !== currentEmail) {
                const conflict = await User.findOne({
                    email: newEmail,
                    roll_no: { $ne: roll_no }
                }).lean();
                if (conflict) {
                    console.warn(
                        `Resume email '${newEmail}' belongs to another user (roll: ${conflict.roll_no}). ` +
                        `Keeping existing email for ${roll_no}.`
                    );
                } else {
                    updateFields.email = newEmail;
                }
            }
        }

        // ===== STEP 4: Persist update — DB errors handled separately =====
        let updatedUser;
        try {
            updatedUser = await User.findOneAndUpdate(
                { roll_no },
                { $set: updateFields },
                { new: true, runValidators: true }
            ).select("-password");
        } catch (dbErr) {
            console.error("DB Update Error:", dbErr.message, "code:", dbErr.code, "keys:", dbErr.keyValue);
            // Parsing worked, only the persistence step failed. Return the
            // extracted data so the user at least sees what we parsed; they
            // can manually save their profile after fixing the conflict.
            const isDup = dbErr.code === 11000;
            return res.status(isDup ? 409 : 500).json({
                message: isDup
                    ? `Some profile fields couldn't be updated due to a conflict (${Object.keys(dbErr.keyValue || {}).join(', ')}). Your skills are saved.`
                    : "Resume was parsed but the profile update failed. Please try again.",
                extracted_data: extractedData,
                user: existingUser,
                conflict_field: isDup ? Object.keys(dbErr.keyValue || {}) : undefined,
            });
        }

        return res.status(200).json({
            message: "Resume parsed successfully",
            extracted_data: extractedData,
            user: updatedUser
        });
    } catch (error) {
        console.error("Resume Parsing Error:", error.message);
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (_) {}
        }
        return res.status(500).json({ message: "Error processing resume." });
    }
};

module.exports = { loginUser, uploadAndParseResume };