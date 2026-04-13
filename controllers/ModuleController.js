const Module = require("../models/module");
const Technology = require("../models/technology")
const mongoose = require('mongoose');
// const { handleFileUpload } = require('../utils/fileUploadUtil');

const addModule = async (req, res, next) => {
  try {
    const { module_name, technology } = req.body;
    
    const module = new Module({
      technology: technology,
      module_name: module_name,
      added_by: "test"
    });

    const savedModule = await module.save();
    if (savedModule) {
      return res.status(200).json(savedModule);
    } else {
      return res.status(500).json({ message: "Failed to save Module." });
    }
  } catch (error) {
    return res.status(500).json({ message: "Internal server error." });
  }
};
const getModules = async (req, res, next) => {
  try {
    const modules = await Module.aggregate([
      {
        $lookup: {
          from:"technologies",
          localField:"technology",
          foreignField:"_id",
          as:"technologyInfo"
        }
      },
      {
        $addFields: {
          technology_name:{ $arrayElemAt:["$technologyInfo.technology_name",0]}
        }
      },
      {
        $project: {
          technologyInfo : 0
        }
      }
    ])
    if (modules.length > 0) {
      return res.status(200).json(modules);
    } else {
      return res.status(404).json({ message: "Modules not found" });
    }
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getModuleById = async (req, res, next) => {
  const moduleId = req.params.id;
  try {
    const module = await Module.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(moduleId)
        }
      }
    ]);

    if (!module || module.length === 0) {
      return res.status(404).json({ message: "Module not found" });
    }
    res.status(200).json(module[0]);
  } catch (error) {
    console.error("Error fetching module:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
const updateModule = async (req, res, next) => {
  const moduleId = req.params.id;
  const { module_name, technology, status } = req.body;
 
  try {
    const module = await Module.findById(moduleId);
    if (!module) {
      return res.status(404).json({ message: "Module not found" });
    }
    if(module_name != 'undefined') {
      module.module_name = module_name
    }
    if (technology != 'undefined') {
      module.technology = technology;
    }
    if (status != 'undefined') {
      module.status = status;
    }
  

    await module.save();

    return res.status(200).json({ message: "Module updated successfully", module });
  } catch (error) {
    console.error("Error updating Module:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
const deleteModule = async (req, res, next) => {
  const moduleId = req.params.id;

  try {
    const deleteModule = await Module.findByIdAndDelete(moduleId);

    if (!deleteModule) {
      return res.status(404).json({ message: "Module not found" });
    }

    return res.status(200).json({ message: "Module deleted successfully" });
  } catch(error) {
    console.error("Error deleting Module:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
const getModulesByTechnology = async (req, res, next) => {
  const technology_id = req.body.technology_id;
  function isValidObjectId(id) {
    return typeof id === "string" && id.length === 24;
  }

  try {
    if(isValidObjectId(technology_id)){

      const technology = await Technology.findById(technology_id);
      
      if (!technology) {
        return res.status(404).json({ message: "Technology not found" });
      }   
      const modules = await Module.find({ technology: { $in: technology._id } });     
      res.status(200).json(modules);
    }else{
      return res.status(400).json({message:"Invalid Technology Id"})
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

const getModulesByTechnologies = async (req, res, next) => {
  let technologies = req.body.technologies;
  technologies = technologies.map(ele=>new mongoose.Types.ObjectId(ele))
  try {
    technologies = await Module.aggregate(
      [
        {
          $match:
           
            {
              technology: {
                $in: technologies,
              },
            },
        },
        {
          $lookup:
          
            {
              from: "technologies",
              localField: "technology",
              foreignField: "_id",
              as: "technologyInfo",
            },
        },
        {
          $lookup:
            
            {
              from: "courses",
              localField: "technologyInfo.course",
              foreignField: "_id",
              as: "courseInfo",
            },
        },
        {
          $project:
           
            {
              course_id: {
                $arrayElemAt: ["$courseInfo._id", 0],
              },
              technology_id: {
                $arrayElemAt: [
                  "$technologyInfo._id",
                  0,
                ],
              },
              course_name: {
                $arrayElemAt: [
                  "$courseInfo.course_name",
                  0,
                ],
              },
              technology_name: {
                $arrayElemAt: [
                  "$technologyInfo.technology_name",
                  0,
                ],
              },
              module_id: "$_id",
              module_name: "$module_name",
            },
        },
      ]
    )
    return res.status(200).json(technologies)

  } catch (err) {
    return res.status(500).json(err)
  }
}


module.exports = {
  addModule,
  getModules,
  getModuleById,
  updateModule,
  deleteModule,
  getModulesByTechnology,
  getModulesByTechnologies,

};
