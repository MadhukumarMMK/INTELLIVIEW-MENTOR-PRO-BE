const express = require('express');
const router = express.Router();
const AdminSettings = require('../models/AdminSettings');
const Interview = require('../models/interview');
// Auth middleware can be added later when admin auth is implemented
// const isAdmin = require('../middleware/isAdmin');
// const verifyToken = require('../middleware/verifyToken');

// --- 1. CONFIGURATION DASHBOARD ---
router.get('/settings', async (req, res) => {
    try {
        let settings = await AdminSettings.findOne();
        if (!settings) {
            settings = await AdminSettings.create({}); // Create default if none exists
        }
        res.status(200).json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/settings', async (req, res) => {
    try {
        let settings = await AdminSettings.findOne();
        if (!settings) settings = new AdminSettings();
        
        settings.max_interviews = req.body.max_interviews ?? settings.max_interviews;
        settings.default_password = req.body.default_password || settings.default_password;
        settings.questions_per_session = req.body.questions_per_session || settings.questions_per_session;
        settings.questions_resume = req.body.questions_resume ?? settings.questions_resume;
        settings.questions_custom = req.body.questions_custom ?? settings.questions_custom;
        settings.questions_hr = req.body.questions_hr ?? settings.questions_hr;
        settings.session_time_limit = req.body.session_time_limit || settings.session_time_limit;
        settings.starting_difficulty = req.body.starting_difficulty || settings.starting_difficulty;
        
        await settings.save();
        res.status(200).json({ message: "Global settings updated", settings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 2. ANALYTICS & AUDITING (with server-side pagination) ---
router.get('/analytics/interviews', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';

        const filter = { status: 2 };
        if (search) {
            filter.$or = [
                { roll_no: { $regex: search, $options: 'i' } },
                { technology_name: { $regex: search, $options: 'i' } }
            ];
        }

        const [interviews, totalCount] = await Promise.all([
            Interview.find(filter)
                .select('roll_no overall_score emotions createdAt updatedAt start_date_time technology_name level questions_count')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Interview.countDocuments(filter)
        ]);

        res.status(200).json({
            interviews,
            pagination: {
                page,
                limit,
                totalCount,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// All interviews (no pagination) for charts — lightweight
router.get('/analytics/summary', async (req, res) => {
    try {
        const interviews = await Interview.find({ status: 2 })
            .select('overall_score createdAt roll_no')
            .sort({ createdAt: -1 });
        res.status(200).json(interviews);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 3. USER MANAGEMENT ---
const User = require('../models/user');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const xlsx = require('xlsx');

const excelStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `bulk-${Date.now()}-${file.originalname}`)
});
const uploadExcel = multer({ storage: excelStorage });

// List all users (paginated)
router.get('/users', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const skip = (page - 1) * limit;

        const filter = { role: { $ne: 'admin' } };
        if (search) {
            filter.$or = [
                { roll_no: { $regex: search, $options: 'i' } },
                { first_name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const [users, totalCount] = await Promise.all([
            User.find(filter).select('-password').sort({ created_at: -1 }).skip(skip).limit(limit),
            User.countDocuments(filter)
        ]);

        res.json({ users, pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Single user registration
router.post('/users/create', async (req, res) => {
    try {
        const { roll_no, first_name, email, college, branch, passout_year } = req.body;
        if (!roll_no) return res.status(400).json({ message: "Roll number is required" });

        const exists = await User.findOne({ roll_no });
        if (exists) return res.status(409).json({ message: `User ${roll_no} already exists` });

        const settings = await AdminSettings.findOne();
        const defaultPwd = settings?.default_password || 'intelliview@123';
        const hashedPwd = await bcrypt.hash(defaultPwd, 10);

        const newUser = await User.create({
            roll_no,
            first_name: first_name || '',
            email: email || `${roll_no}@intelliview.local`,
            password: hashedPwd,
            college: college || '',
            branch: branch || '',
            passout_year: passout_year || null,
            role: 'student',
            status: 1
        });

        res.status(201).json({ message: `User ${roll_no} created with default password`, user: { ...newUser.toObject(), password: undefined } });
    } catch (err) {
        res.status(500).json({ message: "Failed to create user", error: err.message });
    }
});

// Bulk user registration via Excel upload
// Excel columns: roll_no, first_name, email, college, branch, passout_year
router.post('/users/bulk-upload', uploadExcel.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        const workbook = xlsx.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet);

        if (!rows.length) return res.status(400).json({ message: "Excel file is empty" });

        const settings = await AdminSettings.findOne();
        const defaultPwd = settings?.default_password || 'intelliview@123';
        const hashedPwd = await bcrypt.hash(defaultPwd, 10);

        let created = 0, skipped = 0, errors = [];

        for (const row of rows) {
            const roll_no = String(row.roll_no || row.Roll_No || row.RollNo || row.rollno || '').trim();
            if (!roll_no) { skipped++; continue; }

            try {
                const exists = await User.findOne({ roll_no });
                if (exists) { skipped++; continue; }

                await User.create({
                    roll_no,
                    first_name: row.first_name || row.name || row.Name || '',
                    email: row.email || row.Email || `${roll_no}@intelliview.local`,
                    password: hashedPwd,
                    college: row.college || row.College || '',
                    branch: row.branch || row.Branch || '',
                    passout_year: parseInt(row.passout_year || row.year || row.Year) || null,
                    role: 'student',
                    status: 1
                });
                created++;
            } catch (e) {
                errors.push(`${roll_no}: ${e.message}`);
            }
        }

        // Cleanup uploaded file
        const fs = require('fs');
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        res.json({
            message: `Bulk upload complete: ${created} created, ${skipped} skipped`,
            created, skipped, total: rows.length,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (err) {
        res.status(500).json({ message: "Bulk upload failed", error: err.message });
    }
});

// Delete user
router.delete('/users/:roll_no', async (req, res) => {
    try {
        const user = await User.findOneAndDelete({ roll_no: req.params.roll_no });
        if (!user) return res.status(404).json({ message: "User not found" });
        // Also delete their interviews
        await Interview.deleteMany({ roll_no: req.params.roll_no });
        res.json({ message: `User ${req.params.roll_no} and their data deleted` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reset user password to default
router.put('/users/:roll_no/reset-password', async (req, res) => {
    try {
        const settings = await AdminSettings.findOne();
        const defaultPwd = settings?.default_password || 'intelliview@123';
        const hashedPwd = await bcrypt.hash(defaultPwd, 10);
        await User.findOneAndUpdate({ roll_no: req.params.roll_no }, { password: hashedPwd });
        res.json({ message: `Password reset to default for ${req.params.roll_no}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;