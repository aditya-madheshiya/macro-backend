const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Photo = require('../models/Photo');
const adminAuth = require('../middleware/adminAuth');

// 📊 1. GET SYSTEM STATS (Live Count from DB)
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const totalPhotos = await Photo.countDocuments();
    const trendingPhotos = await Photo.countDocuments({ isTrending: true });

    res.json({
      totalUsers,
      totalPhotos,
      trendingPhotos,
      totalRevenue: "$4,250.00" // यह आप पेमेंट गेटवे इंटीग्रेट होने पर लाइव कर सकते हैं
    });
  } catch (err) {
    res.status(500).json({ message: 'Server Error Fetching Stats' });
  }
});

// 👥 2. GET ALL USERS LIST
router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server Error Fetching Users' });
  }
});

// 🗑️ 3. BAN/DELETE A USER
router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User unit permanently purged from matrix' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;