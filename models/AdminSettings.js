const mongoose = require('mongoose');

const adminSettingsSchema = new mongoose.Schema({
    max_interviews: { type: Number, default: 6 },
    default_password: { type: String, default: 'intelliview@123' },
    questions_per_session: { type: Number, default: 3 }, // Legacy fallback
    questions_resume: { type: Number, default: 10 },
    questions_custom: { type: Number, default: 10 },
    questions_hr: { type: Number, default: 8 },
    // Per-question time limit in SECONDS, configurable per interview mode.
    // When timer hits 0, the question is auto-skipped and the interview
    // advances to the next one. Default 60s.
    time_per_question_resume: { type: Number, default: 60 },
    time_per_question_custom: { type: Number, default: 60 },
    time_per_question_hr:     { type: Number, default: 60 },
    session_time_limit: { type: Number, default: 15 },
    starting_difficulty: {
        type: String,
        enum: ['Easy', 'Medium', 'Hard'],
        default: 'Medium'
    },

    // Expo Mode — single toggle that activates the voice-greeted name capture
    // flow + leaderboard. When false (default), real-user behaviour is unchanged.
    expo_mode: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('AdminSettings', adminSettingsSchema);