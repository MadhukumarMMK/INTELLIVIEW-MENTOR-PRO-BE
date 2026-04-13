// routes/generalRoutes.js
const express = require('express');
const router = express.Router();
const techCtrl = require('../controllers/TechnologyController');
const moduleCtrl = require('../controllers/ModuleController');
const topicCtrl = require('../controllers/TopicController');

// --- READ (used by InterviewSetup) ---
router.get('/technologies', techCtrl.gettechnologies);
router.post('/modules-by-tech', moduleCtrl.getModulesByTechnology);
router.post('/topics-by-module', topicCtrl.getTopicsByModule);

// --- CRUD for Admin Hierarchy Management ---
// Technologies
router.post('/technologies', techCtrl.addTechnology);
router.put('/technologies/:id', techCtrl.updateTechnology);
router.delete('/technologies/:id', techCtrl.deleteTechnology);

// Modules
router.get('/modules', moduleCtrl.getModules);
router.post('/modules', moduleCtrl.addModule);
router.put('/modules/:id', moduleCtrl.updateModule);
router.delete('/modules/:id', moduleCtrl.deleteModule);

// Topics
router.get('/topics', topicCtrl.getTopics);
router.post('/topics', topicCtrl.addTopic);
router.put('/topics/:id', topicCtrl.updateTopic);
router.delete('/topics/:id', topicCtrl.deleteTopic);

module.exports = router;