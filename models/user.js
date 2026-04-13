const mongoose = require("mongoose");

const UserSchema = mongoose.Schema({
  first_name: { type: String },
  roll_no: { type: String, index: true },
  password: { type: String },
  email: { type: String, unique: true, lowercase: true },
  gender: { type: String },
  college: { type: String, index: true },
  branch: { type: String, index: true },
  passout_year: { type: Number, index: true },
  role: { type: String },
  
  // Phase 2 Fields (Populated by the Python NLP Engine)
  mobile_number: { type: String },
  skills: { type: [String], default: [] },
  certifications: { type: [mongoose.Schema.Types.Mixed], default: [] },

  // Profile Fields
  profile_picture: { type: String, default: "" },
  resume_path: { type: String, default: "" },
  bio: { type: String, default: "" },
  github_url: { type: String, default: "" },
  linkedin_url: { type: String, default: "" },

  status: { type: Number, default: 1 },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, {
  collection: 'users'
});

module.exports = mongoose.model("user", UserSchema);