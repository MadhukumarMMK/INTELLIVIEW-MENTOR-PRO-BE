const Technology = require("../models/technology");
const mongoose = require('mongoose');
// const { handleFileUpload } = require('../utils/fileUploadUtil');

const addTechnology = async (req, res, next) => {
  try {
    const { technology_name, technology_category } = req.body;

    const technology = new Technology({
     
      technology_name: technology_name,
      
      technology_category: technology_category,
      status:1,
      added_by: "test"
    });
    const savedTechnology = await technology.save();
    if (savedTechnology) {
      return res.status(200).json(savedTechnology);
    } else {
      return res.status(500).json({ message: "Failed to save Technology." });
    }
  } catch (error) {
    return res.status(500).json({ message: "Internal server error." });
  }
};
const gettechnologies = async (req, res, next) => {
  try {
    const technologies = await Technology.find()
    if (technologies.length > 0) {
      return res.status(200).json(technologies);
    } else {
      return res.status(404).json({ message: "Technologies not found" });
    }
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error." });
  }
};


const getTechnologyById = async (req, res, next) => {
  const technologyId = req.params.id;
  try {
    const technology = await Technology.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(technologyId)
        }
      }
    ]);

    if (!technology || technology.length === 0) {
      return res.status(404).json({ message: "Technology not found" });
    }
    res.status(200).json(technology[0]);
  } catch (error) {
    console.error("Error fetching technology:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
const updateTechnology = async (req, res, next) => {
  const technologyId = req.params.id;
  const { technology_name, status, technology_category } = req.body;

  try {
    const technology = await Technology.findById(technologyId);
    if (!technology) {
      return res.status(404).json({ message: "Technology not found" });
    }

    if (technology_name && technology_name !== "undefined") {
      technology.technology_name = technology_name;
    }

    if (technology_category && technology_category !== "undefined") {
      technology.technology_category = technology_category;
    }

    if (status !== "undefined") {
      technology.status = parseInt(status, 10);
    }

    // if (req.file) {
    //   if (technology.technology_icon && fs.existsSync(`./uploads/technology-icons/${technology.technology_icon}`)) {
    //     fs.unlinkSync(`./uploads/technology-icons/${technology.technology_icon}`);
    //   }

    //   technology.technology_icon = req.file.filename;
    // }

    await technology.save();

    return res.status(200).json({ message: "Technology updated successfully", technology });
  } catch (error) {
    console.error("Error updating Technology:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const deleteTechnology = async (req, res, next) => {
  const technologyId = req.params.id;

  try {
    const deleteTechnology = await Technology.findByIdAndDelete(technologyId);

    if (!deleteTechnology) {
      return res.status(404).json({ message: "Technology not found" });
    }

    return res.status(200).json({ message: "Technology deleted successfully" });
  } catch (error) {
    console.error("Error deleting Technology:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
  addTechnology,
  gettechnologies,
  getTechnologyById,
  updateTechnology,
  deleteTechnology,

};
