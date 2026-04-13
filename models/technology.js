
const mongoose = require('mongoose');
const schema = mongoose.Schema;
const Technology = new schema({

    technology_name: {
        type: String,
        // required: true,
    },

    technology_category: {
        type: String,
        required: true,
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
        collection: 'technologies'
    });

module.exports = mongoose.model("Technology", Technology);


