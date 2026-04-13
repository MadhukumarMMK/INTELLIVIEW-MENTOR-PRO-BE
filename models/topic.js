
const mongoose = require('mongoose');
const schema = mongoose.Schema;
const Topic = new schema({
    technology: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'technology',
        index:true,
    },
    module: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'module',
        index:true,
    },
    topic_name: {
        type: String,
        // required: true,
    },
    
    added_by: {
        type: String,
        // required: true,
    },
    status: {
        type: Number,
        default: 1,
    },
},
    {
        timestamps: true
    },
    {
        collection: 'topics'
    });

module.exports = mongoose.model("Topic", Topic);


