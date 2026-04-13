const mongoose = require('mongoose');

const adminSettingsSchema = new mongoose.Schema({
    max_interviews: { type: Number, default: 6 },
    default_password: { type: String, default: 'intelliview@123' },
    questions_per_session: { type: Number, default: 3 }, // Legacy fallback
    questions_resume: { type: Number, default: 10 },
    questions_custom: { type: Number, default: 10 },
    questions_hr: { type: Number, default: 8 },
    session_time_limit: { type: Number, default: 15 },
    starting_difficulty: {
        type: String,
        enum: ['Easy', 'Medium', 'Hard'],
        default: 'Medium'
    }
}, { timestamps: true });

module.exports = mongoose.model('AdminSettings', adminSettingsSchema);