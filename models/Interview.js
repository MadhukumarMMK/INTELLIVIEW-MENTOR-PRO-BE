const mongoose = require("mongoose");

const InterviewSchema = mongoose.Schema({
  roll_no: { type: String, required: true },
  
  // The Hierarchy
  technology: { type: mongoose.Schema.Types.ObjectId, ref: 'technology' },
  technology_name: { type: String },
  module: { type: [mongoose.Schema.Types.ObjectId], ref: 'module' },
  module_names: { type: [String] },
  topic: { type: [mongoose.Schema.Types.ObjectId], ref: 'topic' },
  topic_names: { type: [String] },
  
  // Interview Metadata
  start_date_time: { type: Date, required: true },
  level: { type: String, required: true },
  questions_count: { type: String },
  
  // Performance & AI Analysis
  question_details: { type: Array },
  overall_analysis: { type: Array },
  
  // Multimodal Emotion Data (from face-api.js & CNN-LSTM)
  emotions: {
    seen_left: String, 
    seen_right: String, 
    seen_center: String, 
    blinks: String,
    time_straight: String, 
    time_left: String, 
    time_right: String,
    emotions: {
      angry: Number, 
      disgust: Number, 
      fear: Number, 
      happy: Number,
      sad: Number, 
      surprise: Number, 
      neutral: Number,
    },
  },
  
  overall_score: { type: Number, default: 0 },
  created_by: { type: String },
  status: { type: Number },

  // Soft-archive (frees a slot without destroying the report).
  // Only non-archived completed interviews count against the per-user limit.
  archived: { type: Boolean, default: false },
  archived_at: { type: Date },

  // Mode: 'resume' | 'custom' | 'hr' — needed so archived reports can be grouped by type.
  mode: { type: String },
}, {
  timestamps: true,
  collection: 'interviews'
});

module.exports = mongoose.model("interview", InterviewSchema);