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

        // Find the existing user so we can clean up their previous resume file
        const existingUser = await User.findOne({ roll_no });
        if (!existingUser) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ message: "User not found." });
        }

        // Send the NEW file to the Python parser for skill extraction
        const formData = new FormData();
        formData.append('file', fs.createReadStream(req.file.path), req.file.originalname);

        const pythonUrl = process.env.PYTHON_ENGINE_URL || 'http://localhost:5002';

        try {
            const nlpResponse = await axios.post(
                `${pythonUrl}/api/extract-resume`,
                formData,
                { headers: { ...formData.getHeaders() }, timeout: 30000 }
            );

            const extractedData = nlpResponse.data.data;
            if (!extractedData) throw new Error("No data returned from parser");

            // Parse succeeded — only now is it safe to delete the OLD resume file
            if (existingUser.resume_path && existingUser.resume_path !== req.file.path) {
                try {
                    if (fs.existsSync(existingUser.resume_path)) {
                        fs.unlinkSync(existingUser.resume_path);
                    }
                } catch (cleanupErr) {
                    console.warn("Could not remove previous resume:", cleanupErr.message);
                }
            }

            // Build update fields — a resume re-upload is the user declaring the new
            // resume is their current source of truth, so REPLACE skills AND refresh
            // identity fields (name, email, github, linkedin, mobile) from the new CV.
            const updateFields = {
                skills: extractedData.skills || [],
                resume_path: req.file.path,
                mobile_number: extractedData.mobile_number || existingUser.mobile_number || "",
            };

            if (extractedData.name) updateFields.first_name = extractedData.name;
            if (extractedData.email) updateFields.email = extractedData.email;
            if (extractedData.github) updateFields.github_url = extractedData.github;
            if (extractedData.linkedin) updateFields.linkedin_url = extractedData.linkedin;

            const updatedUser = await User.findOneAndUpdate(
                { roll_no },
                { $set: updateFields },
                { new: true }
            ).select("-password");

            return res.status(200).json({
                message: "Resume parsed successfully",
                extracted_data: extractedData,
                user: updatedUser
            });

        } catch (apiError) {
            console.error("Python Bridge Error:", apiError.message);
            // Parser failed — delete the NEW file so we don't orphan it
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch (_) {}
            }
            return res.status(503).json({
                message: "Resume parser is unavailable. Please try again shortly."
            });
        }

    } catch (error) {
        console.error("Resume Parsing Error:", error.message);
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (_) {}
        }
        return res.status(500).json({ message: "Error processing resume." });
    }
};

module.exports = { loginUser, uploadAndParseResume };