const express = require('express');
const router = express.Router();
const AdminSettings = require('../models/AdminSettings');
const Interview = require('../models/Interview');
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
        settings.time_per_question_resume = req.body.time_per_question_resume ?? settings.time_per_question_resume;
        settings.time_per_question_custom = req.body.time_per_question_custom ?? settings.time_per_question_custom;
        settings.time_per_question_hr     = req.body.time_per_question_hr     ?? settings.time_per_question_hr;
        settings.session_time_limit = req.body.session_time_limit || settings.session_time_limit;
        settings.starting_difficulty = req.body.starting_difficulty || settings.starting_difficulty;
        if (req.body.expo_mode !== undefined) settings.expo_mode = !!req.body.expo_mode;

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

        // Exclude archived interviews from admin analytics — archived is a
        // student-side soft-delete that frees a slot but should not inflate stats.
        const filter = { status: 2, archived: { $ne: true } };
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

// All interviews (no pagination) for charts — lightweight. Excludes archived.
router.get('/analytics/summary', async (req, res) => {
    try {
        const interviews = await Interview.find({ status: 2, archived: { $ne: true } })
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

// List users (paginated + filterable + aggregates).
// Query: page, limit, search, college, branch, startDate, endDate, sortBy, sortOrder
router.get('/users', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = (req.query.search || '').trim();
        const college = (req.query.college || '').trim();
        const branch = (req.query.branch || '').trim();
        const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
        const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
        // sortBy ∈ { 'created_at', 'best_score', 'total_interviews', 'first_name' }
        const sortBy = req.query.sortBy || 'created_at';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
        const skip = (page - 1) * limit;

        // --- Stage 1: User match filter (fast path — uses indexes on college/branch) ---
        const userMatch = { role: { $ne: 'admin' } };
        if (search) {
            userMatch.$or = [
                { roll_no: { $regex: search, $options: 'i' } },
                { first_name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        if (college) userMatch.college = college;
        if (branch) userMatch.branch = branch;
        if (startDate || endDate) {
            userMatch.created_at = {};
            if (startDate) userMatch.created_at.$gte = startDate;
            if (endDate) userMatch.created_at.$lte = endDate;
        }

        // --- Stage 2: Aggregate with interview join to produce per-user stats ---
        // Sort field map: some fields need computed values; translate to aggregation-friendly names
        const sortField = {
            created_at: 'created_at',
            best_score: 'best_score',
            total_interviews: 'total_interviews',
            first_name: 'first_name'
        }[sortBy] || 'created_at';

        const pipeline = [
            { $match: userMatch },
            {
                $lookup: {
                    from: 'interviews',
                    let: { rn: '$roll_no' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$roll_no', '$$rn'] },
                                        { $eq: ['$status', 2] },
                                        { $ne: ['$archived', true] }
                                    ]
                                }
                            }
                        },
                        { $project: { overall_score: 1, mode: 1, technology_name: 1, createdAt: 1, level: 1 } }
                    ],
                    as: 'interviews'
                }
            },
            {
                $addFields: {
                    total_interviews: { $size: '$interviews' },
                    best_score: { $ifNull: [ { $max: '$interviews.overall_score' }, 0 ] },
                    technologies: {
                        $setUnion: [
                            { $filter: {
                                input: '$interviews.technology_name',
                                as: 't',
                                cond: { $and: [ { $ne: ['$$t', null] }, { $ne: ['$$t', ''] } ] }
                            } },
                            []
                        ]
                    },
                    best_resume: {
                        $max: {
                            $map: {
                                input: { $filter: { input: '$interviews', as: 'i', cond: { $eq: ['$$i.mode', 'resume'] } } },
                                as: 'i',
                                in: '$$i.overall_score'
                            }
                        }
                    },
                    best_custom: {
                        $max: {
                            $map: {
                                input: { $filter: { input: '$interviews', as: 'i', cond: { $eq: ['$$i.mode', 'custom'] } } },
                                as: 'i',
                                in: '$$i.overall_score'
                            }
                        }
                    },
                    best_hr: {
                        $max: {
                            $map: {
                                input: { $filter: { input: '$interviews', as: 'i', cond: { $eq: ['$$i.mode', 'hr'] } } },
                                as: 'i',
                                in: '$$i.overall_score'
                            }
                        }
                    }
                }
            },
            { $project: { password: 0, interviews: 0 } },
            { $sort: { [sortField]: sortOrder, _id: 1 } },
            {
                $facet: {
                    data: [ { $skip: skip }, { $limit: limit } ],
                    totalCount: [ { $count: 'count' } ]
                }
            }
        ];

        const [result] = await User.aggregate(pipeline);
        const users = result?.data || [];
        const totalCount = result?.totalCount?.[0]?.count || 0;

        res.json({
            users,
            pagination: {
                page,
                limit,
                totalCount,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (err) {
        console.error('Admin users API error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Distinct colleges + branches for filter dropdowns
router.get('/users/filter-facets', async (req, res) => {
    try {
        const [colleges, branches] = await Promise.all([
            User.distinct('college', { role: { $ne: 'admin' }, college: { $nin: [null, ''] } }),
            User.distinct('branch', { role: { $ne: 'admin' }, branch: { $nin: [null, ''] } })
        ]);
        res.json({
            colleges: colleges.sort(),
            branches: branches.sort()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Resume download proxy — admin downloads a user's resume by roll_no
router.get('/users/:roll_no/resume', async (req, res) => {
    try {
        const user = await User.findOne({ roll_no: req.params.roll_no });
        if (!user?.resume_path) return res.status(404).json({ message: 'No resume on file for this user.' });
        const path = require('path');
        const fs = require('fs');
        const abs = path.resolve(user.resume_path);
        if (!fs.existsSync(abs)) return res.status(404).json({ message: 'Resume file is missing on disk.' });
        res.download(abs, path.basename(user.resume_path));
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

// --- Expo Leaderboard ---
// Returns the top scorers (with names) ranked by a combined accuracy +
// confidence score. Only completed, named, non-archived interviews count.
//
// Combined score = 0.7 × overall_score + 0.3 × avg(question_details.fused_confidence)
//
// The avg_confidence is computed in-aggregation from question_details so we
// don't need a denormalized field on the document — the data is already there.
router.get('/leaderboard', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const board = await Interview.aggregate([
            {
                $match: {
                    status: 2,
                    archived: { $ne: true },
                    candidate_name: { $exists: true, $nin: [null, ""] }
                }
            },
            {
                $addFields: {
                    avg_confidence: {
                        $cond: {
                            if: { $gt: [{ $size: { $ifNull: ['$question_details', []] } }, 0] },
                            then: {
                                $avg: {
                                    $map: {
                                        input: '$question_details',
                                        as: 'q',
                                        in: { $ifNull: ['$$q.fused_confidence', 0] }
                                    }
                                }
                            },
                            else: 0
                        }
                    }
                }
            },
            {
                $addFields: {
                    combined_score: {
                        $add: [
                            { $multiply: [{ $ifNull: ['$overall_score', 0] }, 0.7] },
                            { $multiply: ['$avg_confidence', 0.3] }
                        ]
                    }
                }
            },
            { $sort: { combined_score: -1, start_date_time: -1 } },
            { $limit: limit },
            {
                $project: {
                    _id: 1,
                    candidate_name: 1,
                    technology_name: 1,
                    mode: 1,
                    overall_score: 1,
                    avg_confidence: { $round: ['$avg_confidence', 0] },
                    combined_score: { $round: ['$combined_score', 1] },
                    start_date_time: 1
                }
            }
        ]);
        res.json({ leaderboard: board });
    } catch (err) {
        console.error('Leaderboard error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;