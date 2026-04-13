
const mongoose = require('mongoose');
const schema = mongoose.Schema;
const Module = new schema({
    technology: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'technology',
        index:true,
    },
    module_name: {
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
        collection: 'modules'
    });

module.exports = mongoose.model("Module", Module);


