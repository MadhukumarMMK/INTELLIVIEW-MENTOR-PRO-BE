const Topic = require("../models/topic");
const Module = require("../models/module");
const mongoose = require('mongoose');
const xlsx = require('xlsx');

const addTopic = async (req, res, next) => {
  try {
    const { topic_name, module, technology } = req.body;
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const topics = xlsx.utils.sheet_to_json(sheet, { header: 'A' }).map((row) => Object.values(row)[0].toString());

    const savedTopics = [];
    for (const ele of topics) {
      console.log("this is topic"+ele)
      const topic = new Topic({
        technology: technology,
        module: module,
        topic_name: ele,
        added_by: "test"
      });
      const savedTopic = await topic.save();
      savedTopics.push(savedTopic);
    }
    console.log("these are saved topics"+savedTopics)
    if (savedTopics.length > 0) {
      return res.status(200).json(savedTopics);
    } else {
      return res.status(500).json({ message: "Failed to save topics." });
    }
  } catch (error) {
    console.error('Error processing file:', error);
    return res.status(500).json({ message: "Internal server error." });
  }
};
const getTopics = async (req, res, next) => {
  try {
    const topics = await Topic.aggregate([
      {
        $lookup: {
          from: "modules",
          localField: "module",
          foreignField: "_id",
          as: "moduleInfo"
        }
      },
      {
        $lookup: {
          from: "technologies",
          localField: "technology",
          foreignField: "_id",
          as: "technologyInfo"
        }
      },
      {
        $addFields: {
          module_name: { $arrayElemAt: ["$moduleInfo.module_name", 0] },
          technology_name: { $arrayElemAt: ["$technologyInfo.technology_name", 0] }
        }
      },
      {
        $project: {
          moduleInfo: 0
        }
      }
    ])
    if (topics.length > 0) {
      return res.status(200).json(topics);
    } else {
      return res.status(404).json({ message: "Topics not found" });
    }
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getTopicById = async (req, res, next) => {
  const topicId = req.params.id;
  try {
    const topic = await Topic.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(topicId)
        }
      }
    ]);

    if (!topic || topic.length === 0) {
      return res.status(404).json({ message: "Topic not found" });
    }
    res.status(200).json(topic[0]);
  } catch (error) {
    console.error("Error fetching topic:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
const updateTopic = async (req, res, next) => {
  const topicId = req.params.id;
  const { topic_name, module, technology, status } = req.body;
  try {
    const topic = await Topic.findById(topicId);
    if (!topic) {
      return res.status(404).json({ message: "Topic not found" });
    }
    if (topic_name != 'undefined') {
      topic.topic_name = topic_name
    }
    if (module != 'undefined') {
      topic.module = module;
    }
    if (technology != 'undefined') {
      topic.technology = technology;
    }
    if (status != 'undefined') {
      topic.status = status;
    }


    await topic.save();

    return res.status(200).json({ message: "Topic updated successfully", topic });
  } catch (error) {
    console.error("Error updating Topic:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
const deleteTopic = async (req, res, next) => {
  const topicId = req.params.id;

  try {
    const deleteTopic = await Topic.findByIdAndDelete(topicId);

    if (!deleteTopic) {
      return res.status(404).json({ message: "Topic not found" });
    }

    return res.status(200).json({ message: "Topic deleted successfully" });
  } catch (error) {
    console.error("Error deleting Topic:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

const getTopicsByModule = async (req, res, next) => {
  let module_id = req.body.module_id;
  if (typeof (module_id) == "string" && req.body.module_id.length==24) {
    module_id = new mongoose.Types.ObjectId(req.body.module_id)
    try {
      const module = await Module.findById(module_id);
  
      if (!module) {
        return res.status(404).json({ message: "Module not found" });
      }
      const topics = await Topic.find({ module: module._id });
      res.status(200).json(topics);
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }else{
    res.status(200).json({message:"some thing went wrong"})
  }
  
}

const getTopicsByMultiModules = async (req, res, next) => {
  let module_ids = req.body.module_ids;
  
  // Check if module_ids is an array
  if (Array.isArray(module_ids) && module_ids.every(id => mongoose.Types.ObjectId.isValid(id))) {
    module_ids = module_ids.map(id => new mongoose.Types.ObjectId(id));

    try {
      // Find topics for each module ID
      const topics = await Topic.find({ module: { $in: module_ids } });

      res.status(200).json(topics);
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  } else {
    res.status(400).json({ message: "Invalid module IDs provided" });
  }
};


const topicsTotalReport = async (req, res, next) => {
  const technology = req.body.technology;
  
  try {
    const result = await Topic.aggregate([
      {
        $match: {
          technology: new mongoose.Types.ObjectId(technology),
        },
      },
      {
        $lookup: {
          from: "technologies",
          localField: "technology",
          foreignField: "_id",
          as: "technologyInfo",
        },
      },
      {
        $unwind: "$technologyInfo",
      },
      {
        $lookup: {
          from: "courses", // Assuming the collection name for courses is 'courses'
          localField: "technologyInfo.course",
          foreignField: "_id",
          as: "courseInfo",
        },
      },
      {
        $unwind: "$courseInfo",
      },
      {
        $lookup: {
          from: "modules",
          localField: "module",
          foreignField: "_id",
          as: "moduleInfo",
        },
      },
      {
        $unwind: "$moduleInfo",
      },
      {
        $group: {
          _id: {
            course_name: "$courseInfo.course_name", // Assuming `course_name` field in courses collection
            technology_name: "$technologyInfo.technology_name",
            module_name: "$moduleInfo.module_name",
            topic_name: "$topic_name",
          },
        },
      },
      {
        $project: {
          _id: 0,
          course_name: "$_id.course_name",
          technology_name: "$_id.technology_name",
          module_name: "$_id.module_name",
          topic_name: "$_id.topic_name",
        },
      },
      {
        $sort:{
          module_name:1
        }
      }
    ]);

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};
module.exports = {
  addTopic,
  getTopics,
  getTopicById,
  updateTopic,
  deleteTopic,
  getTopicsByModule,
  getTopicsByMultiModules,
  topicsTotalReport

};
